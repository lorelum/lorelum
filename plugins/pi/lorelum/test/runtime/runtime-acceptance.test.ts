import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";

import lorelumExtensionDefault, { lorelumExtension } from "../../extensions/lorelum.ts";
import { installLoreCli, type LoreCliFixture } from "./cli-fixture.ts";
import {
  catalogsIn,
  createRuntimeHarness,
  createSingleHarness,
  type Harness,
  type ProviderRequest,
} from "./harness.ts";

interface TestEnv {
  readonly cwd: string;
  readonly agentDir: string;
  readonly cli: LoreCliFixture;
  readonly cleanup: () => void;
}

/**
 * Create an isolated project/agent dir and prepend a fixture `lore` to the
 * process PATH so the production adapter resolves it. `cleanup` restores PATH
 * because the adapter reads `process.env` at spawn time.
 */
function createEnv(): TestEnv {
  const root = mkdtempSync(join(tmpdir(), "lorelum-pi-runtime-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const cli = installLoreCli(join(root, "cli"));
  const previousPath = process.env.PATH;
  process.env.PATH = `${cli.binDir}${delimiter}${previousPath ?? ""}`;
  return {
    cwd,
    agentDir,
    cli,
    cleanup: () => {
      process.env.PATH = previousPath;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function conversationRequests(harness: Harness): ProviderRequest[] {
  return harness.providerRequests.filter((request) => request.kind === "conversation");
}

function expectCatalogsPerRequest(harness: Harness): void {
  for (const request of harness.providerRequests) {
    expect(catalogsIn(request.messages)).toBe(request.kind === "conversation" ? 1 : 0);
  }
}

function userTextCount(
  messages: readonly { readonly role: string; readonly content?: unknown }[],
  text: string,
): number {
  return messages.filter(
    (message) => message.role === "user" && JSON.stringify(message.content).includes(text),
  ).length;
}

/**
 * Three prior turns so `prepareCompaction` finds a summarizable prefix under a
 * small `keepRecentTokens`. Each seed is long enough that the retained-recent
 * budget still leaves history behind the cut point.
 */
async function seedTurns(harness: Harness): Promise<void> {
  for (const index of [1, 2, 3]) {
    // Each seed turn must settle before the next; the session projection is sequential state.
    // eslint-disable-next-line no-await-in-loop -- sequential turns build the session context.
    await harness.session.prompt(`seed ${index} `.repeat(40));
  }
}

test("the default export is the same factory as the named export", () => {
  expect(lorelumExtensionDefault).toBe(lorelumExtension);
});

test("startup seeds one Catalog and ordinary requests reuse it without another CLI call", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({ cwd: env.cwd, agentDir: env.agentDir });
  try {
    expect(harness.events).toContain("session_start:startup");
    expect(env.cli.invocations()).toHaveLength(1);
    expect(env.cli.invocations()[0]).toContain("session_start");

    await harness.session.prompt("first request");
    await harness.session.prompt("second request");

    // Two conversation requests, each with exactly one projected Catalog.
    const conversations = conversationRequests(harness);
    expect(conversations).toHaveLength(2);
    expect(conversations[0]?.messages).not.toBe(conversations[1]?.messages);
    expectCatalogsPerRequest(harness);
    // The second request reused the startup snapshot; no CLI process was spawned.
    expect(env.cli.invocations()).toHaveLength(1);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("manual compaction refreshes the Catalog; the next request has exactly one", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({
    cwd: env.cwd,
    agentDir: env.agentDir,
    keepRecentTokens: 20,
  });
  try {
    await seedTurns(harness);
    expect(env.cli.invocations()).toHaveLength(1);

    await harness.session.compact("manual instructions");

    expect(harness.events).toContain("session_compact:manual:retry=false");
    expect(env.cli.invocations()).toHaveLength(2);
    expect(env.cli.invocations()[1]).toContain("session_compact");

    await harness.session.prompt("after manual compaction");
    expect(catalogsIn(harness.providerRequests.at(-1)!.messages)).toBe(1);
    // Reused the refreshed snapshot for the ordinary request.
    expect(env.cli.invocations()).toHaveLength(2);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("automatic threshold compaction refreshes once and keeps one Catalog per request", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({
    cwd: env.cwd,
    agentDir: env.agentDir,
    contextWindow: 500,
    reserveTokens: 1,
    keepRecentTokens: 20,
  });
  try {
    await seedTurns(harness);
    // A long *response* crosses `contextWindow - reserveTokens` on total tokens
    // while the prompt stays inside the window, selecting threshold (not overflow).
    harness.enqueueConversation(fauxAssistantMessage("y".repeat(3_200)));
    await harness.session.prompt("threshold trigger");

    expect(harness.events.some((event) => event.startsWith("session_compact:threshold"))).toBe(
      true,
    );
    // Request kind comes from the context event, independent of the Catalog.
    expectCatalogsPerRequest(harness);
    expect(conversationRequests(harness).length).toBeGreaterThanOrEqual(2);
    // Startup plus the single threshold refresh.
    expect(env.cli.invocations()).toHaveLength(2);

    await harness.session.prompt("after threshold compaction");
    expect(catalogsIn(harness.providerRequests.at(-1)!.messages)).toBe(1);
    expect(env.cli.invocations()).toHaveLength(2);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("overflow compaction retries internally with one Catalog and no new user turn", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({
    cwd: env.cwd,
    agentDir: env.agentDir,
    keepRecentTokens: 20,
  });
  try {
    await seedTurns(harness);
    const cliBeforeOverflow = env.cli.invocations().length;
    const conversationBeforeOverflow = conversationRequests(harness).length;

    harness.enqueueConversationError("prompt is too long: 999 tokens > 100 maximum");
    await harness.session.prompt("the overflowing turn");

    expect(
      harness.events.some((event) => event.startsWith("session_compact:overflow:retry=true")),
    ).toBe(true);
    // The internal continuation is one more conversation request than the failed
    // original; it still carries exactly one Catalog.
    const conversations = conversationRequests(harness);
    expect(conversations.length).toBe(conversationBeforeOverflow + 2);
    expectCatalogsPerRequest(harness);
    expect(catalogsIn(conversations.at(-1)!.messages)).toBe(1);
    // Compaction refresh adds one CLI call; the retried turn does not refresh again.
    expect(env.cli.invocations()).toHaveLength(cliBeforeOverflow + 1);
    // No new user turn: the overflowing prompt appears exactly once in the session.
    expect(userTextCount(harness.session.messages, "the overflowing turn")).toBe(1);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("transient provider errors retry without refreshing the Catalog", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({ cwd: env.cwd, agentDir: env.agentDir });
  try {
    await harness.session.prompt("warm up");
    const cliBeforeRetry = env.cli.invocations().length;

    harness.enqueueConversationError("503 Service Unavailable");
    await harness.session.prompt("retry this");

    expect(harness.events.some((event) => event.startsWith("agent:auto_retry_start"))).toBe(true);
    expect(
      harness.events.some(
        (event) => event.startsWith("agent:auto_retry_end") && event.includes("success=true"),
      ),
    ).toBe(true);
    const retried = conversationRequests(harness).slice(-2);
    expect(retried).toHaveLength(2);
    for (const request of retried) {
      expect(catalogsIn(request.messages)).toBe(1);
    }
    // A transient retry is not a lifecycle boundary; no CLI refresh.
    expect(env.cli.invocations()).toHaveLength(cliBeforeRetry);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("a cancelled compaction keeps the original Catalog and does not refresh", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({
    cwd: env.cwd,
    agentDir: env.agentDir,
    keepRecentTokens: 20,
    cancelCompact: true,
  });
  try {
    await seedTurns(harness);
    const cliBeforeCancel = env.cli.invocations().length;

    await expect(harness.session.compact()).rejects.toThrow(/cancel/i);

    expect(
      harness.events.some((event) =>
        event.startsWith("session_compact_failed:manual:aborted=true"),
      ),
    ).toBe(true);
    expect(env.cli.invocations()).toHaveLength(cliBeforeCancel);

    // The original startup Catalog is still projected on the next request.
    await harness.session.prompt("after cancelled compaction");
    expect(catalogsIn(harness.providerRequests.at(-1)!.messages)).toBe(1);
    expect(env.cli.invocations()).toHaveLength(cliBeforeCancel);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("a failed compaction keeps the original Catalog and does not refresh", async () => {
  const env = createEnv();
  const harness = await createSingleHarness({
    cwd: env.cwd,
    agentDir: env.agentDir,
    keepRecentTokens: 20,
  });
  try {
    await seedTurns(harness);
    const cliBeforeFailure = env.cli.invocations().length;
    harness.setSummarizationFailure("summarization exploded");

    await expect(harness.session.compact()).rejects.toThrow();

    expect(
      harness.events.some((event) =>
        event.startsWith("session_compact_failed:manual:aborted=false"),
      ),
    ).toBe(true);
    expect(env.cli.invocations()).toHaveLength(cliBeforeFailure);

    await harness.session.prompt("after failed compaction");
    expect(catalogsIn(harness.providerRequests.at(-1)!.messages)).toBe(1);
    expect(env.cli.invocations()).toHaveLength(cliBeforeFailure);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});

test("runtime.newSession rebuilds the session, refreshes the Catalog, and drops old context", async () => {
  const env = createEnv();
  const harness = await createRuntimeHarness({ cwd: env.cwd, agentDir: env.agentDir });
  try {
    expect(harness.events).toContain("session_start:startup");
    await harness.session.prompt("first session turn");
    const cliBeforeNew = env.cli.invocations().length;

    await harness.newSession();

    expect(harness.events).toContain("session_shutdown:new");
    expect(harness.events).toContain("session_start:new");
    // The replacement session runs its own startup refresh.
    expect(env.cli.invocations()).toHaveLength(cliBeforeNew + 1);

    await harness.session.prompt("second session turn");
    const last = harness.providerRequests.at(-1)!;
    expect(catalogsIn(last.messages)).toBe(1);
    // The old session's conversation is not carried into the replacement.
    expect(JSON.stringify(last.messages)).not.toContain("first session turn");
    expect(env.cli.invocations()).toHaveLength(cliBeforeNew + 1);
  } finally {
    await harness.dispose();
    env.cleanup();
  }
});
