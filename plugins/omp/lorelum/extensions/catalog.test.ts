import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPracticeHintService } from "../../../../packages/backend/src/modules/practice-hints/service";
import {
  DEFAULT_AGENT_HOOK_SETTINGS,
  loadSubagentPackCatalogSetting,
} from "../../../../packages/cli/src/hook/agent-settings";
import type { HookServiceOverrides } from "../../../../packages/cli/src/hook/command";
import { invokeHook } from "../../../../packages/cli/src/hook/endpoint.test-helper";
import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
  ToolCallEventResult,
} from "@oh-my-pi/pi-coding-agent";
import { registerLorelum } from "./catalog";
import type { BridgeExecution, BridgeExecutor, BridgeRequest } from "./subprocess";

type Messages = ContextEvent["messages"];
const CATALOG = "Lorelum Installed Pack Catalog\n- payments: Safe payment retries";
const success = {
  stdout: JSON.stringify({ additionalContext: CATALOG }) + "\n",
  code: 0,
};
const NOTICE = "Lorelum update available: 1.2.0";

const shutdowns: Array<() => unknown> = [];
afterEach(() => {
  for (const shutdown of shutdowns) shutdown();
  shutdowns.length = 0;
});

function harness(
  execute: BridgeExecutor,
  hasUI = true,
  options: { sessionId?: string; agent?: ExtensionContext["agent"]; cwd?: string } = {},
) {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const persist = mock(() => {
    throw new Error("Catalog must not persist or start a turn");
  });
  const notify = mock(() => {});
  const api = {
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(name, handler),
    sendMessage: persist,
    sendUserMessage: persist,
    appendEntry: persist,
    registerTool: persist,
    // Every factory owns a distinct bus; using it for parent handoff would fail.
    events: { on: persist, emit: persist },
  } as unknown as ExtensionAPI;
  registerLorelum(api, execute);
  let sessionId = options.sessionId ?? "actual-main-session";
  const ctx = {
    cwd: options.cwd ?? "/workspace/one",
    hasUI,
    ui: { notify },
    agent: options.agent ?? { kind: "main", id: "Main", name: "main", depth: 0 },
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext;
  shutdowns.push(() => handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx));
  return {
    handlers,
    persist,
    notify,
    ctx,
    boundary: (name: string, nextSessionId?: string) => {
      if (nextSessionId !== undefined) sessionId = nextSessionId;
      return handlers.get(name)!({ type: name }, ctx);
    },
    switchSession: (next: string) => {
      sessionId = next;
      return handlers.get("session_switch")!({ type: "session_switch", reason: "resume" }, ctx);
    },
    spawn: (spawnKey: string | undefined, invocationKind: "task" | "eval" = "task") =>
      handlers.get("before_subagent_spawn")!(
        { type: "before_subagent_spawn", spawnKey, invocationKind, agent: "task", patterns: [] },
        ctx,
      ),
    tool: async (input: Record<string, unknown>, toolName = "bash") =>
      (await handlers.get("tool_call")!(
        { type: "tool_call", toolCallId: "bash-call", toolName, input },
        ctx,
      )) as ToolCallEventResult | undefined,
    context: async (messages: Messages = []) => {
      const result = (await handlers.get("context")!(
        { type: "context", messages },
        ctx,
      )) as ContextEventResult;
      return result.messages!;
    },
  };
}

function text(message: Messages[number]): string {
  if (message.role !== "user" || typeof message.content === "string")
    throw new Error("Expected native user text blocks");
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("omp request-scoped Catalog", () => {
  test("lazily reads once, supplies native user metadata, and does not persist or change policy", async () => {
    const execute = mock<BridgeExecutor>(async () => success);
    const host = harness(execute);
    host.boundary("session_start");
    expect(execute).toHaveBeenCalledTimes(0);
    const user: Messages[number] = { role: "user", content: "Please fix retries", timestamp: 1 };
    const original = [user];
    const first = await host.context(original);
    expect(text(first[0]!)).toBe(CATALOG);
    expect(first[0]!.role).toBe("user");
    expect(first[1]).toBe(user);
    expect(original).toEqual([user]);
    const second = await host.context(original);
    expect(second[0]).toBe(first[0]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0].cwd).toBe("/workspace/one");
    expect(execute.mock.calls[0]![0].request).toEqual({
      event: "catalog",
      agentKind: "main",
      sessionId: "actual-main-session",
      checkUpdates: true,
    });
    expect(host.persist).toHaveBeenCalledTimes(0);
  });

  test("delivers a one-shot update notice separately from the reusable Catalog", async () => {
    const execute = mock<BridgeExecutor>(async () => ({
      stdout: JSON.stringify({ additionalContext: CATALOG, updateNotice: NOTICE }) + "\n",
      code: 0,
    }));
    const host = harness(execute);
    const user: Messages[number] = { role: "user", content: "Continue", timestamp: 1 };
    const first = await host.context([user]);
    expect(first).toHaveLength(3);
    expect(text(first[0]!)).toBe(NOTICE);
    expect(text(first[1]!)).toBe(CATALOG);
    expect(first[2]).toBe(user);

    const second = await host.context(first);
    expect(second).toHaveLength(2);
    expect(text(second[0]!)).toBe(CATALOG);
    expect(second[1]).toBe(user);
    expect(await host.context(second)).toEqual(second);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("concurrent context callbacks consume one notice only once", async () => {
    const execute = mock<BridgeExecutor>(async () => ({
      stdout: JSON.stringify({ additionalContext: CATALOG, updateNotice: NOTICE }) + "\n",
      code: 0,
    }));
    const host = harness(execute);
    const [first, second] = await Promise.all([host.context(), host.context()]);
    const notices = [first, second].filter((messages) =>
      messages.some((message) => text(message) === NOTICE),
    );
    expect(notices).toHaveLength(1);
    expect(first.some((message) => text(message) === CATALOG)).toBe(true);
    expect(second.some((message) => text(message) === CATALOG)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("an exact legacy empty response retries only the unextended main Catalog request", async () => {
    const requests: BridgeRequest[] = [];
    const execute = mock<BridgeExecutor>(async ({ request }) => {
      requests.push(request);
      return requests.length === 1 ? { stdout: "{}\n", code: 0 } : success;
    });
    const host = harness(execute);
    const messages = await host.context();
    expect(text(messages[0]!)).toBe(CATALOG);
    expect(requests).toEqual([
      { event: "catalog", agentKind: "main", sessionId: "actual-main-session", checkUpdates: true },
      { event: "catalog", agentKind: "main" },
    ]);
  });

  test("a malformed enhanced response does not trigger legacy retry", async () => {
    const execute = mock<BridgeExecutor>(async () => ({ stdout: "not-json", code: 0 }));
    const host = harness(execute);
    expect(await host.context()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(host.notify).toHaveBeenCalledTimes(1);
  });

  test("an invalid update notice is ignored without dropping the Catalog", async () => {
    const execute = mock<BridgeExecutor>(async () => ({
      stdout: JSON.stringify({ additionalContext: CATALOG, updateNotice: "x".repeat(401) }) + "\n",
      code: 0,
    }));
    const host = harness(execute);
    const messages = await host.context();
    expect(messages).toHaveLength(1);
    expect(text(messages[0]!)).toBe(CATALOG);
    expect(host.notify).toHaveBeenCalledTimes(0);
  });

  test("update checks follow main-session lifecycle identity, excluding same-id compact", async () => {
    const execute = mock<BridgeExecutor>(async () => success);
    const host = harness(execute, true, { sessionId: "session-one" });
    host.boundary("session_start");
    await host.context();
    expect(execute.mock.calls[0]![0].request).toEqual({
      event: "catalog",
      agentKind: "main",
      sessionId: "session-one",
      checkUpdates: true,
    });

    host.boundary("session_compact");
    await host.context();
    expect(execute.mock.calls[1]![0].request).toEqual({ event: "catalog", agentKind: "main" });

    host.boundary("session_branch", "session-two");
    await host.context();
    expect(
      execute.mock.calls.filter(([call]) => call.request.event === "catalog")[2]![0].request,
    ).toEqual({
      event: "catalog",
      agentKind: "main",
      sessionId: "session-two",
      checkUpdates: true,
    });

    host.boundary("session_tree", "session-three");
    await host.context();
    expect(
      execute.mock.calls.filter(([call]) => call.request.event === "catalog")[3]![0].request,
    ).toEqual({
      event: "catalog",
      agentKind: "main",
      sessionId: "session-three",
      checkUpdates: true,
    });

    host.switchSession("session-four");
    await host.context();
    expect(
      execute.mock.calls.filter(([call]) => call.request.event === "catalog")[4]![0].request,
    ).toEqual({
      event: "catalog",
      agentKind: "main",
      sessionId: "session-four",
      checkUpdates: true,
    });
  });

  test("subagent Catalog refreshes never request update checks", async () => {
    const execute = mock<BridgeExecutor>(async () => success);
    const host = harness(execute, true, {
      agent: { kind: "sub", id: "child", name: "child", depth: 1 },
    });
    host.boundary("session_start");
    await host.context();
    expect(execute.mock.calls[0]![0].request).toEqual({ event: "catalog", agentKind: "sub" });
  });

  test("only removes its own message identities, retaining identical real user and other extension messages", async () => {
    const host = harness(async () => success);
    const realUser: Messages[number] = {
      role: "user",
      content: [{ type: "text", text: CATALOG }],
      timestamp: 1,
    };
    const otherExtension: Messages[number] = {
      role: "custom",
      customType: "other",
      content: CATALOG,
      display: false,
      timestamp: 2,
    };
    const first = await host.context([realUser, otherExtension]);
    const unchanged = await host.context(first);
    expect(unchanged).toBe(first);
    const duplicates = await host.context([realUser, first[0]!, otherExtension, first[0]!]);
    expect(duplicates).toEqual([first[0]!, realUser, otherExtension]);
  });

  for (const boundary of [
    "session_start",
    "session_switch",
    "session_branch",
    "session_tree",
    "session_compact",
  ]) {
    test(`${boundary} clears old metadata and lazily refreshes at the current cwd`, async () => {
      const execute = mock<BridgeExecutor>(async ({ request }) =>
        request.event === "read-hints" ? { stdout: "{}", code: 0 } : success,
      );
      const host = harness(execute);
      const first = await host.context();
      host.ctx.cwd = "/workspace/two";
      host.boundary(boundary);
      host.boundary(boundary);
      expect(execute).toHaveBeenCalledTimes(1);
      const next = await host.context(first);
      expect(next).toHaveLength(1);
      expect(next[0]).not.toBe(first[0]);
      expect(text(next[0]!)).toBe(CATALOG);
      expect(execute.mock.calls[1]![0].cwd).toBe("/workspace/two");
      await host.context();
      expect(execute.mock.calls.filter(([call]) => call.request.event === "catalog")).toHaveLength(
        2,
      );
    });
  }

  test("concurrent callbacks share one read and reuse the same snapshot", async () => {
    const gate = Promise.withResolvers<BridgeExecution>();
    const execute = mock<BridgeExecutor>(() => gate.promise);
    const host = harness(execute);
    const firstUser: Messages[number] = { role: "user", content: "first", timestamp: 1 };
    const secondUser: Messages[number] = { role: "user", content: "second", timestamp: 2 };
    const first = host.context([firstUser]);
    const second = host.context([secondUser]);
    expect(execute).toHaveBeenCalledTimes(1);
    gate.resolve(success);
    const [a, b] = await Promise.all([first, second]);
    expect(a[0]).toBe(b[0]);
    expect(text(a[0]!)).toBe(CATALOG);
    expect(a[1]).toBe(firstUser);
    expect(b[1]).toBe(secondUser);
  });

  test.each(["success", "failure", "legacy-empty"] as const)(
    "a late old %s cannot inject into or overwrite the new session",
    async (outcome) => {
      const old = Promise.withResolvers<BridgeExecution>();
      let call = 0;
      let oldSignal: AbortSignal | undefined;
      const host = harness(async ({ signal }) => {
        if (call++ === 0) {
          oldSignal = signal;
          return old.promise;
        }
        return { ...success, stdout: JSON.stringify({ additionalContext: "New session Catalog" }) };
      });
      const staleRequest = host.context();
      host.boundary("session_switch");
      expect(oldSignal?.aborted).toBe(true);
      const current = await host.context();
      if (outcome === "success") old.resolve(success);
      else if (outcome === "legacy-empty") old.resolve({ stdout: "{}\n", code: 0 });
      else old.reject(new Error("old read failed"));
      expect(await staleRequest).toEqual([]);
      expect(text(current[0]!)).toBe("New session Catalog");
      expect(text((await host.context())[0]!)).toBe("New session Catalog");
      expect(host.notify).toHaveBeenCalledTimes(0);
      expect(call).toBe(2);
    },
  );

  test("shutdown cancels outstanding metadata work without aborting the host task", async () => {
    let signal: AbortSignal | undefined;
    const gate = Promise.withResolvers<BridgeExecution>();
    const host = harness(async (options) => {
      signal = options.signal;
      return gate.promise;
    });
    const pending = host.context();
    host.boundary("session_shutdown");
    expect(signal?.aborted).toBe(true);
    gate.reject(new Error("cancelled"));
    expect(await pending).toEqual([]);
    expect(host.notify).toHaveBeenCalledTimes(0);
    expect(host.persist).toHaveBeenCalledTimes(0);
  });

  test("shutdown discards the snapshot and does not restart reads for late callbacks", async () => {
    const execute = mock<BridgeExecutor>(async () => success);
    const host = harness(execute);
    const first = await host.context();
    const user: Messages[number] = { role: "user", content: "continue", timestamp: 1 };
    host.boundary("session_shutdown");
    expect(await host.context([...first, user])).toEqual([user]);
    const original = [user];
    expect(await host.context(original)).toBe(original);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(host.notify).toHaveBeenCalledTimes(0);
  });

  for (const [name, result] of [
    ["unsupported CLI", { stdout: "{}", code: 0 }],
    ["bad JSON", { stdout: "{", code: 0 }],
    ["multiple JSON lines", { stdout: "{}\n{}", code: 0 }],
    ["nonzero exit", { ...success, code: 1 }],
    ["empty context", { stdout: '{"additionalContext":" "}', code: 0 }],
    [
      "unbounded context",
      { stdout: JSON.stringify({ additionalContext: "x".repeat(4_001) }), code: 0 },
    ],
  ] as const) {
    test(`${name} clears old values, continues the request and never retries at the same boundary`, async () => {
      let calls = 0;
      const host = harness(async ({ request }) => {
        if (request.event === "read-hints") return { stdout: "{}", code: 0 };
        return calls++ === 0 ? success : result;
      });
      const old = await host.context();
      host.boundary("session_compact");
      const user: Messages[number] = { role: "user", content: "continue", timestamp: 2 };
      expect(await host.context([...old, user])).toEqual([user]);
      const original = [user];
      expect(await host.context(original)).toBe(original);
      expect(calls).toBe(2);
      expect(host.notify).toHaveBeenCalledTimes(1);
      host.boundary("session_switch");
      await host.context();
      expect(host.notify).toHaveBeenCalledTimes(1);
    });
  }

  for (const failure of ["ENOENT", "Catalog read timed out after 10 seconds"]) {
    test(`${failure} is a metadata-only failure and reload permits recovery`, async () => {
      let calls = 0;
      const host = harness(async () => {
        if (calls++ === 0) throw new Error(failure);
        return success;
      });
      expect(await host.context()).toEqual([]);
      expect(await host.context()).toEqual([]);
      expect(calls).toBe(1);
      expect(host.notify).toHaveBeenCalledTimes(1);
      host.boundary("session_start");
      expect(text((await host.context())[0]!)).toBe(CATALOG);
      expect(calls).toBe(2);
      expect(host.persist).toHaveBeenCalledTimes(0);
    });
  }

  test("headless diagnosis goes once to stderr, never stdout", async () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const host = harness(async () => {
        throw new Error("missing CLI");
      }, false);
      await host.context();
      await host.context();
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stdout).toHaveBeenCalledTimes(0);
      expect(host.notify).toHaveBeenCalledTimes(0);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  test("failed UI diagnosis falls back to stderr without changing the request", async () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const host = harness(async () => {
        throw new Error("missing CLI");
      });
      host.notify.mockImplementation(() => {
        throw new Error("UI unavailable");
      });
      const original: Messages = [{ role: "user", content: "continue", timestamp: 1 }];
      expect(await host.context(original)).toBe(original);
      await host.context(original);
      expect(host.notify).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledTimes(1);
    } finally {
      stderr.mockRestore();
    }
  });

  for (const hasUI of [false, true]) {
    test(`failed stderr diagnosis remains non-blocking with hasUI=${hasUI}`, async () => {
      const stderr = spyOn(process.stderr, "write").mockImplementation(() => {
        throw new Error("stderr unavailable");
      });
      try {
        const execute = mock<BridgeExecutor>(async () => {
          throw new Error("missing CLI");
        });
        const host = harness(execute, hasUI);
        host.notify.mockImplementation(() => {
          throw new Error("UI unavailable");
        });
        const original: Messages = [{ role: "user", content: "continue", timestamp: 1 }];
        expect(await host.context(original)).toBe(original);
        expect(await host.context(original)).toBe(original);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(stderr).toHaveBeenCalledTimes(1);
        expect(host.notify).toHaveBeenCalledTimes(hasUI ? 1 : 0);
      } finally {
        stderr.mockRestore();
      }
    });
  }
});

describe("omp native Bash session association", () => {
  test("rewrites only command, uses actual session identity, and leaves native approval and all input fields intact", async () => {
    const command =
      "export LORELUM_HOST_KEY='omp' LORELUM_HOST_SESSION_ID='actual-main-session'; lore get retry";
    const execute = mock<BridgeExecutor>(async () => ({
      stdout: JSON.stringify({ command, allow: true, block: false, additionalContext: "ignored" }),
      code: 0,
    }));
    const host = harness(execute);
    const ready = { port: 4321, host: "127.0.0.1", log: "ready", timeout: 15 };
    const input = {
      command: "lore get retry",
      cwd: "/tool/cwd",
      timeout: 60,
      pty: false,
      async: true,
      name: "owned-service",
      ready,
      i: "Reading retry practice",
    };
    const result = await host.tool(input);
    expect(result).toEqual({ input: { ...input, command } });
    expect(result?.input?.ready).toBe(ready);
    expect(input.command).toBe("lore get retry");
    expect(Object.keys(result!)).toEqual(["input"]);
    expect(execute.mock.calls[0]![0].request).toEqual({
      event: "shell",
      sessionId: "actual-main-session",
      command: "lore get retry",
    });
    expect(execute.mock.calls[0]![0].cwd).toBe("/workspace/one");
    host.switchSession("another-actual-session");
    await host.tool(input);
    expect(execute.mock.calls[1]![0].request).toEqual({
      event: "shell",
      sessionId: "another-actual-session",
      command: "lore get retry",
    });
    expect(host.persist).toHaveBeenCalledTimes(0);
  });

  for (const result of [
    { stdout: "{}", code: 0 },
    { stdout: "{", code: 0 },
    { stdout: "{}\n{}", code: 0 },
    { stdout: "null", code: 0 },
    { stdout: "[]", code: 0 },
    { stdout: '{"command":""}', code: 0 },
    { stdout: '{"command":"  "}', code: 0 },
    { stdout: '{"command":12}', code: 0 },
    { stdout: '{"command":"lore get retry"}', code: 0 },
    { stdout: '{"command":"changed"}', code: 1 },
  ]) {
    test(`unusable shell response ${JSON.stringify(result)} preserves the original call`, async () => {
      const host = harness(async () => result);
      const input = { command: "lore get retry", timeout: 30, pty: true };
      expect(await host.tool(input)).toBeUndefined();
      expect(input).toEqual({ command: "lore get retry", timeout: 30, pty: true });
      expect(host.notify).toHaveBeenCalledTimes(0);
    });
  }

  for (const failure of ["ENOENT", "Lorelum bridge timed out"]) {
    test(`${failure} cannot rewrite or authorize Bash`, async () => {
      const host = harness(async () => {
        throw new Error(failure);
      });
      const input = { command: "lore get retry", async: true };
      expect(await host.tool(input)).toBeUndefined();
      expect(input.command).toBe("lore get retry");
      expect(host.persist).toHaveBeenCalledTimes(0);
    });
  }

  test("non-Bash and malformed inputs never invoke the shell bridge", async () => {
    const execute = mock<BridgeExecutor>(async () => ({ stdout: "{}", code: 0 }));
    const host = harness(execute);
    expect(await host.tool({ command: "lore get retry" }, "other-shell")).toBeUndefined();
    expect(await host.tool({ command: 12 })).toBeUndefined();
    expect(await host.tool({ path: "file" }, "read")).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(0);
  });

  for (const boundary of ["session_switch", "session_shutdown"]) {
    test(`${boundary} cancels a shell rewrite and ignores its late response`, async () => {
      const gate = Promise.withResolvers<BridgeExecution>();
      let signal: AbortSignal | undefined;
      const execute = mock<BridgeExecutor>(async (options) => {
        signal = options.signal;
        return gate.promise;
      });
      const host = harness(execute);
      const input = { command: "lore get retry", timeout: 30 };
      const pending = host.tool(input);
      host.boundary(boundary);
      expect(signal?.aborted).toBe(true);
      gate.resolve({ stdout: '{"command":"late replacement"}', code: 0 });
      expect(await pending).toBeUndefined();
      expect(input.command).toBe("lore get retry");
      if (boundary === "session_shutdown") {
        expect(await host.tool(input)).toBeUndefined();
        expect(execute).toHaveBeenCalledTimes(1);
      }
    });
  }
});

const HINTS =
  "Lorelum read Practice candidates\n- retry: Main-read candidate\nUsage is unverified. Read the full Practice before using it.";

describe("omp Main compact recovery", () => {
  test("startup/resume do not recover hints, compact replaces one temporary snapshot", async () => {
    let hints = HINTS;
    const execute = mock<BridgeExecutor>(async ({ request }) =>
      request.event === "read-hints"
        ? { stdout: JSON.stringify({ additionalContext: hints }), code: 0 }
        : success,
    );
    const host = harness(execute);
    const user: Messages[number] = {
      role: "user",
      content: [{ type: "text", text: "continue work" }],
      timestamp: 1,
    };
    host.boundary("session_start");
    const startup = await host.context([user]);
    host.boundary("session_switch");
    const resumed = await host.context(startup);
    expect(resumed.map(text)).toEqual([CATALOG, "continue work"]);
    expect(execute.mock.calls.filter(([call]) => call.request.event === "read-hints")).toHaveLength(
      0,
    );

    host.boundary("session_compact");
    host.boundary("session_compact");
    const [first, concurrent] = await Promise.all([host.context(resumed), host.context(resumed)]);
    expect(first.map(text)).toEqual([CATALOG, HINTS, "continue work"]);
    expect(concurrent).toEqual(first);
    expect(await host.context(first)).toBe(first);
    expect(
      execute.mock.calls
        .filter(([call]) => call.request.event === "read-hints")
        .map(([call]) => call.request),
    ).toEqual([{ event: "read-hints", sessionId: "actual-main-session" }]);

    hints = "A newly read Practice";
    host.boundary("session_compact");
    const next = await host.context([...first, first[1]!]);
    expect(next.map(text)).toEqual([CATALOG, hints, "continue work"]);
    expect(host.persist).not.toHaveBeenCalled();
  });

  test("background commit invalidates in-flight metadata without publishing a late old result", async () => {
    const old = Promise.withResolvers<BridgeExecution>();
    let oldSignal: AbortSignal | undefined;
    let hintCalls = 0;
    const execute = mock<BridgeExecutor>(async ({ request, signal }) => {
      if (request.event !== "read-hints") return success;
      if (hintCalls++ === 0) {
        oldSignal = signal;
        return old.promise;
      }
      return { stdout: JSON.stringify({ additionalContext: "After background commit" }), code: 0 };
    });
    const host = harness(execute);
    const user: Messages[number] = {
      role: "user",
      content: [{ type: "text", text: "original task" }],
      timestamp: 1,
    };
    const initial = await host.context([user]);
    // Summarization running in the background has not committed an event yet.
    expect(await host.context(initial)).toBe(initial);
    expect(hintCalls).toBe(0);
    host.boundary("session_compact");
    const stale = host.context(initial);
    host.boundary("session_compact");
    expect(oldSignal?.aborted).toBe(true);
    const fresh = await host.context(initial);
    old.resolve({
      stdout: JSON.stringify({ additionalContext: "Before background commit" }),
      code: 0,
    });
    expect(await stale).toEqual([user]);
    expect(fresh.map(text)).toEqual([CATALOG, "After background commit", "original task"]);
    expect(await host.context(fresh)).toBe(fresh);
    expect(hintCalls).toBe(2);
    expect(host.persist).not.toHaveBeenCalled();
  });

  for (const boundary of [
    "session_start",
    "session_switch",
    "session_branch",
    "session_tree",
    "session_shutdown",
  ]) {
    test(`${boundary} clears Main recovery qualification and stale messages`, async () => {
      const execute = mock<BridgeExecutor>(async ({ request }) =>
        request.event === "read-hints"
          ? { stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 }
          : success,
      );
      const host = harness(execute);
      host.boundary("session_compact");
      const old = await host.context();
      host.boundary(boundary, boundary === "session_switch" ? "other-session" : undefined);
      const next = await host.context(old);
      expect(next.map(text)).toEqual(boundary === "session_shutdown" ? [] : [CATALOG]);
      expect(
        execute.mock.calls.filter(([call]) => call.request.event === "read-hints"),
      ).toHaveLength(1);
    });
  }

  test("unavailable candidates preserve the Catalog and do not retry on each request", async () => {
    const execute = mock<BridgeExecutor>(async ({ request }) => {
      if (request.event === "read-hints") throw new Error("Backend unavailable");
      return success;
    });
    const host = harness(execute);
    host.boundary("session_compact");
    const first = await host.context();
    expect(first.map(text)).toEqual([CATALOG]);
    expect(await host.context(first)).toBe(first);
    expect(execute.mock.calls.filter(([call]) => call.request.event === "read-hints")).toHaveLength(
      1,
    );
    expect(host.notify).not.toHaveBeenCalled();
  });
});

function childHarness(
  execute: BridgeExecutor,
  id = "Child",
  parentId = "Main",
  sessionId = "actual-child-session",
  depth = 1,
) {
  return harness(execute, true, {
    sessionId,
    agent: { kind: "sub", id, parentId, name: "task", depth },
  });
}

describe("omp Main-session read hints", () => {
  for (const invocationKind of ["task", "eval"] as const) {
    test(`${invocationKind} snapshots Main before switching and injects only temporary user metadata`, async () => {
      const parent = harness(async () => success);
      parent.boundary("session_start");
      parent.spawn("Child", invocationKind);
      parent.switchSession("unrelated-parent-session");
      const execute = mock<BridgeExecutor>(async ({ request }) =>
        request.event === "read-hints"
          ? { stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 }
          : success,
      );
      const child = childHarness(execute);
      child.boundary("session_start");
      expect(execute).toHaveBeenCalledTimes(0);
      const prompt: Messages[number] = {
        role: "user",
        content: "Original assignment",
        timestamp: 1,
      };
      const policy: Messages[number] = {
        role: "custom",
        customType: "host-policy",
        content: "Keep existing host policy",
        display: false,
        timestamp: 2,
      };
      const transcript = [prompt, policy];
      const first = await child.context(transcript);
      expect(first.map((message) => message.role)).toEqual(["user", "user", "user", "custom"]);
      expect(text(first[0]!)).toBe(CATALOG);
      expect(text(first[1]!)).toBe(HINTS);
      expect(first.slice(2)).toEqual(transcript);
      expect(transcript).toEqual([prompt, policy]);
      expect(execute.mock.calls.map(([options]) => options.request)).toEqual([
        { event: "catalog", agentKind: "sub" },
        { event: "read-hints", sessionId: "actual-main-session" },
      ]);
      expect(await child.context(first)).toBe(first);
      expect((await child.context(transcript))[1]).toBe(first[1]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(child.persist).toHaveBeenCalledTimes(0);
      parent.switchSession("yet-another-parent-session");
      child.boundary("session_compact");
      const compacted = await child.context(first);
      expect(compacted).toHaveLength(4);
      expect(compacted[1]).not.toBe(first[1]);
      expect(text(compacted[1]!)).toBe(HINTS);
      expect(execute.mock.calls[3]![0].request).toEqual({
        event: "read-hints",
        sessionId: "actual-main-session",
      });
      expect(child.persist).toHaveBeenCalledTimes(0);
    });
  }

  test("nested and concurrent factories keep Main hints and own shell session identities separate", async () => {
    const execute = mock<BridgeExecutor>(async ({ request }) => {
      if (request.event === "read-hints") {
        return {
          stdout: JSON.stringify({ additionalContext: `Hints from ${request.sessionId}` }),
          code: 0,
        };
      }
      if (request.event === "shell") {
        return {
          stdout: JSON.stringify({ command: `${request.sessionId}: ${request.command}` }),
          code: 0,
        };
      }
      return success;
    });
    // Two top-level factories can have the same registry name, never the same session.
    const parentA = harness(execute, true, { sessionId: "parent-A-session" });
    const parentB = harness(execute, true, { sessionId: "parent-B-session" });
    parentA.spawn("ChildA", "task");
    parentB.spawn("ChildB", "eval");
    const childA = childHarness(execute, "ChildA", "Main", "child-A-session");
    const childB = childHarness(execute, "ChildB", "Main", "child-B-session");
    childA.boundary("session_start");
    childB.boundary("session_start");
    childA.spawn("Grandchild", "eval");
    const grandchild = childHarness(execute, "Grandchild", "ChildA", "grandchild-session", 2);
    grandchild.boundary("session_start");
    const [a, b, nested] = await Promise.all([
      childA.context(),
      childB.context(),
      grandchild.context(),
    ]);
    expect(text(a[1]!)).toBe("Hints from parent-A-session");
    expect(text(b[1]!)).toBe("Hints from parent-B-session");
    expect(text(nested[1]!)).toBe("Hints from parent-A-session");
    const input = { command: "lore get retry", timeout: 30, pty: false };
    expect((await childA.tool(input))?.input?.command).toBe("child-A-session: lore get retry");
    expect((await grandchild.tool(input))?.input?.command).toBe(
      "grandchild-session: lore get retry",
    );
    expect(
      execute.mock.calls.filter(([options]) => options.request.event === "read-hints"),
    ).toHaveLength(3);
  });

  for (const mismatch of [
    "missing-dispatch",
    "missing-key",
    "child-id",
    "parent-id",
    "parent-is-session",
  ]) {
    test(`${mismatch} fails closed without guessing a parent or reading hints`, async () => {
      const parent = harness(async () => success);
      if (mismatch !== "missing-dispatch") {
        parent.spawn(mismatch === "missing-key" ? undefined : "Child");
      }
      const execute = mock<BridgeExecutor>(async () => success);
      const child = childHarness(
        execute,
        mismatch === "child-id" ? "UnrelatedChild" : "Child",
        mismatch === "parent-id"
          ? "OtherMain"
          : mismatch === "parent-is-session"
            ? "actual-main-session"
            : "Main",
      );
      child.boundary("session_start");
      expect(await child.context()).toHaveLength(1);
      expect(execute.mock.calls.map(([options]) => options.request)).toEqual([
        { event: "catalog", agentKind: "sub" },
      ]);
    });
  }

  test("parallel identity conflicts cannot select either parent", async () => {
    const parentA = harness(async () => success, true, { sessionId: "parent-A-session" });
    const parentB = harness(async () => success, true, { sessionId: "parent-B-session" });
    parentA.spawn("Conflicted");
    parentB.spawn("Conflicted", "eval");
    const execute = mock<BridgeExecutor>(async () => success);
    const child = childHarness(execute, "Conflicted");
    child.boundary("session_start");
    expect(await child.context()).toHaveLength(1);
    expect(execute.mock.calls.map(([options]) => options.request)).toEqual([
      { event: "catalog", agentKind: "sub" },
    ]);
  });

  test("a duplicate live child identity revokes cached hints in every claimant", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const execute = mock<BridgeExecutor>(async ({ request }) =>
      request.event === "read-hints"
        ? { stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 }
        : success,
    );
    const childA = childHarness(execute);
    childA.boundary("session_start");
    const old = await childA.context();
    expect(old).toHaveLength(2);
    const childB = childHarness(execute, "Child", "Main", "different-child-session");
    childB.boundary("session_start");
    expect(await childB.context()).toHaveLength(1);
    const refreshed = await childA.context(old);
    expect(refreshed).toHaveLength(1);
    expect(text(refreshed[0]!)).toBe(CATALOG);
    expect(
      execute.mock.calls.filter(([options]) => options.request.event === "read-hints"),
    ).toHaveLength(1);
  });

  test("a conflicting dispatch cancels a claimed child's in-flight hint lookup", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const gate = Promise.withResolvers<BridgeExecution>();
    let signal: AbortSignal | undefined;
    const execute = mock<BridgeExecutor>(async (options) => {
      if (options.request.event !== "read-hints") return success;
      signal = options.signal;
      return gate.promise;
    });
    const child = childHarness(execute);
    child.boundary("session_start");
    const stale = child.context();
    const conflictingParent = harness(async () => success, true, {
      sessionId: "another-parent-session",
    });
    conflictingParent.spawn("Child", "eval");
    expect(signal?.aborted).toBe(true);
    gate.resolve({ stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 });
    expect(await stale).toEqual([]);
    expect(await child.context()).toHaveLength(1);
    expect(
      execute.mock.calls.filter(([options]) => options.request.event === "read-hints"),
    ).toHaveLength(1);
  });

  for (const result of [
    { stdout: "{}", code: 0 },
    { stdout: "{", code: 0 },
    { stdout: "{}\n{}", code: 0 },
    { stdout: '{"additionalContext":""}', code: 0 },
    { stdout: '{"additionalContext":12}', code: 0 },
    { stdout: JSON.stringify({ additionalContext: "x".repeat(1_801) }), code: 0 },
    { stdout: JSON.stringify({ additionalContext: HINTS }), code: 1 },
  ]) {
    test(`empty or failed read hints ${result.stdout.slice(0, 40)} never synthesize metadata or retry each request`, async () => {
      const parent = harness(async () => success);
      parent.spawn("Child");
      const execute = mock<BridgeExecutor>(async ({ request }) =>
        request.event === "read-hints" ? result : success,
      );
      const child = childHarness(execute);
      child.boundary("session_start");
      const first = await child.context();
      expect(first).toHaveLength(1);
      expect(text(first[0]!)).toBe(CATALOG);
      expect(await child.context(first)).toBe(first);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(child.notify).toHaveBeenCalledTimes(0);
      child.boundary("session_compact");
      expect(await child.context(first)).toHaveLength(1);
      expect(execute).toHaveBeenCalledTimes(4);
    });
  }

  test("missing Backend or timed-out hint lookup never blocks Catalog and gets one chance per boundary", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const execute = mock<BridgeExecutor>(async ({ request }) => {
      if (request.event === "read-hints") throw new Error("Backend unavailable or timed out");
      return success;
    });
    const child = childHarness(execute);
    child.boundary("session_start");
    const first = await child.context();
    expect(first).toHaveLength(1);
    expect(await child.context(first)).toBe(first);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(child.notify).toHaveBeenCalledTimes(0);
  });

  test("accepts the renderer's exact 1800-character budget without promoting trust or trimming its warning", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const hints = `${"x".repeat(1_800 - HINTS.length)}${HINTS}`;
    const child = childHarness(async ({ request }) =>
      request.event === "read-hints"
        ? { stdout: JSON.stringify({ additionalContext: hints }), code: 0 }
        : success,
    );
    child.boundary("session_start");
    const messages = await child.context();
    expect(messages[1]!.role).toBe("user");
    expect(text(messages[1]!)).toBe(hints);
    expect(text(messages[1]!)).toHaveLength(1_800);
  });

  test("removes only its own hint identities across reentry and compact, never accumulating a transcript", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const child = childHarness(async ({ request }) =>
      request.event === "read-hints"
        ? { stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 }
        : success,
    );
    child.boundary("session_start");
    const realUser: Messages[number] = { role: "user", content: HINTS, timestamp: 1 };
    const transcript = [realUser];
    const old = await child.context(transcript);
    const duplicate = await child.context([old[1]!, realUser, old[0]!, old[1]!]);
    expect(duplicate).toEqual([old[0]!, old[1]!, realUser]);
    child.boundary("session_compact");
    const refreshed = await child.context(duplicate);
    expect(refreshed).toHaveLength(3);
    expect(refreshed[2]).toBe(realUser);
    expect(refreshed[0]).not.toBe(old[0]);
    expect(refreshed[1]).not.toBe(old[1]);
    expect(transcript).toEqual([realUser]);
    expect(child.persist).toHaveBeenCalledTimes(0);
  });

  for (const outcome of ["success", "failure"] as const) {
    test(`compact cancels hints and discards a late ${outcome} without overwriting the fresh snapshot`, async () => {
      const parent = harness(async () => success);
      parent.spawn("Child");
      const old = Promise.withResolvers<BridgeExecution>();
      let hintCalls = 0;
      let oldSignal: AbortSignal | undefined;
      const execute = mock<BridgeExecutor>(async (options) => {
        if (options.request.event !== "read-hints") return success;
        if (hintCalls++ === 0) {
          oldSignal = options.signal;
          return old.promise;
        }
        return {
          stdout: JSON.stringify({ additionalContext: "Fresh Main hints" }),
          code: 0,
        };
      });
      const child = childHarness(execute);
      child.boundary("session_start");
      const stale = child.context();
      child.boundary("session_compact");
      expect(oldSignal?.aborted).toBe(true);
      const current = await child.context();
      if (outcome === "success")
        old.resolve({ stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 });
      else old.reject(new Error("late failure"));
      expect(await stale).toEqual([]);
      expect(text(current[1]!)).toBe("Fresh Main hints");
      expect((await child.context())[1]).toBe(current[1]);
      expect(hintCalls).toBe(2);
    });
  }

  test("switching the child session clears Main hints rather than carrying them into an unrelated session", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const execute = mock<BridgeExecutor>(async ({ request }) =>
      request.event === "read-hints"
        ? { stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 }
        : success,
    );
    const child = childHarness(execute);
    child.boundary("session_start");
    const old = await child.context();
    child.switchSession("unrelated-child-session");
    const current = await child.context(old);
    expect(current).toHaveLength(1);
    expect(
      execute.mock.calls.filter(([options]) => options.request.event === "read-hints"),
    ).toHaveLength(1);
  });

  test("shutdown cancels pending hints, ignores late results and releases the owned child identity", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const gate = Promise.withResolvers<BridgeExecution>();
    let signal: AbortSignal | undefined;
    const execute = mock<BridgeExecutor>(async (options) => {
      if (options.request.event !== "read-hints") return success;
      signal = options.signal;
      return gate.promise;
    });
    const child = childHarness(execute);
    child.boundary("session_start");
    const pending = child.context();
    child.boundary("session_shutdown");
    expect(signal?.aborted).toBe(true);
    gate.resolve({ stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 });
    expect(await pending).toEqual([]);
    expect(await child.context()).toEqual([]);
    child.spawn("LateGrandchild");
    expect(execute).toHaveBeenCalledTimes(2);
    const newParent = harness(async () => success, true, { sessionId: "new-parent-session" });
    newParent.spawn("Child", "eval");
    const nextExecute = mock<BridgeExecutor>(async ({ request }) =>
      request.event === "read-hints"
        ? {
            stdout: JSON.stringify({ additionalContext: `Hints from ${request.sessionId}` }),
            code: 0,
          }
        : success,
    );
    const nextChild = childHarness(nextExecute, "Child", "Main", "new-child-session");
    nextChild.boundary("session_start");
    expect(text((await nextChild.context())[1]!)).toBe("Hints from new-parent-session");
  });

  test("parent shutdown cleans unclaimed dispatches but cannot substitute a claimed child's snapshot", async () => {
    const parent = harness(async () => success);
    parent.spawn("Unclaimed");
    parent.spawn("Claimed");
    const execute = mock<BridgeExecutor>(async ({ request }) =>
      request.event === "read-hints"
        ? {
            stdout: JSON.stringify({ additionalContext: `Hints from ${request.sessionId}` }),
            code: 0,
          }
        : success,
    );
    const claimed = childHarness(execute, "Claimed");
    claimed.boundary("session_start");
    parent.boundary("session_shutdown");
    const unclaimed = childHarness(execute, "Unclaimed");
    unclaimed.boundary("session_start");
    expect(await unclaimed.context()).toHaveLength(1);
    expect(text((await claimed.context())[1]!)).toBe("Hints from actual-main-session");
    expect(
      execute.mock.calls.filter(([options]) => options.request.event === "read-hints"),
    ).toHaveLength(1);
  });
});

describe("omp independent request metadata boundaries", () => {
  test("concurrent child requests share a single Catalog and Main-hints refresh", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child", "eval");
    const catalogGate = Promise.withResolvers<BridgeExecution>();
    const hintGate = Promise.withResolvers<BridgeExecution>();
    const execute = mock<BridgeExecutor>(({ request }) =>
      request.event === "read-hints" ? hintGate.promise : catalogGate.promise,
    );
    const child = childHarness(execute);
    child.boundary("session_start");
    const userA: Messages[number] = { role: "user", content: "first", timestamp: 1 };
    const userB: Messages[number] = { role: "user", content: "second", timestamp: 2 };
    const a = child.context([userA]);
    const b = child.context([userB]);
    expect(execute).toHaveBeenCalledTimes(2);
    hintGate.resolve({ stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 });
    catalogGate.resolve(success);
    const [first, second] = await Promise.all([a, b]);
    expect(first.slice(0, 2)).toEqual(second.slice(0, 2));
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toBe(second[1]);
    expect(first[2]).toBe(userA);
    expect(second[2]).toBe(userB);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test("failed Catalog discovery does not suppress valid Main hints or elevate their trust", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const execute = mock<BridgeExecutor>(async ({ request }) => {
      if (request.event === "catalog") throw new Error("Catalog unavailable");
      return { stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 };
    });
    const child = childHarness(execute);
    child.boundary("session_start");
    const prompt: Messages[number] = { role: "user", content: "original task", timestamp: 1 };
    const transcript = [prompt];
    const current = await child.context(transcript);
    expect(current).toHaveLength(2);
    expect(current[0]!.role).toBe("user");
    expect(text(current[0]!)).toBe(HINTS);
    expect(current[1]).toBe(prompt);
    expect(await child.context(current)).toBe(current);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(child.notify).toHaveBeenCalledTimes(1);
    expect(child.persist).toHaveBeenCalledTimes(0);
    expect(transcript).toEqual([prompt]);
  });
});

describe("omp configured metadata consumers", () => {
  for (const setting of ["absent", "false", "true"] as const) {
    for (const mainRead of [false, true]) {
      test(`${setting} Catalog with Main reads ${mainRead} keeps nested candidates scoped to Main`, async () => {
        const home = await realpath(await mkdtemp(join(tmpdir(), "lorelum-omp-consumer-")));
        try {
          if (setting !== "absent") {
            await mkdir(join(home, ".lorelum"));
            await writeFile(
              join(home, ".lorelum", "config.yaml"),
              `agent:\n  subagentPackCatalog: ${setting}\n`,
            );
          }
          const hints = createPracticeHintService({ sessionsDirectory: join(home, "sessions") });
          const mainSession = { hostKey: "omp", sessionId: "actual-main-session" } as const;
          if (mainRead) {
            await hints.recordSuccessfulGet(
              home,
              {
                id: "main.read",
                digest: "main-private-digest",
                title: "Successful Main read",
                appliesWhen: "Considering retries",
              },
              mainSession,
            );
          }
          let packReads = 0;
          const services: HookServiceOverrides = {
            storageRoot: { rootPath: join(home, "store") },
            list: {
              listPackDetails: async () => {
                packReads++;
                return {
                  generation: 1,
                  effectiveRevision: 1,
                  packs: [
                    {
                      name: "engineering",
                      version: "1.0.0",
                      packRoot: "/never-expose-pack-path",
                      description: "Engineering metadata",
                      applies_to: ["typescript"],
                    },
                  ],
                };
              },
            },
            subagentPackCatalog: () => loadSubagentPackCatalogSetting({ homeDirectory: home }),
            practiceHints: hints,
            agentHookSettings: async () => DEFAULT_AGENT_HOOK_SETTINGS,
          };
          const execute: BridgeExecutor = async ({ request }) => {
            let stdout = "";
            let stderr = "";
            const code = await invokeHook("omp", {
              stdin: { text: async () => JSON.stringify(request) },
              stdout: {
                write: (message) => {
                  stdout += message;
                },
              },
              stderr: {
                write: (message) => {
                  stderr += message;
                },
              },
              services,
            });
            expect(stderr).toBe("");
            return { stdout, code };
          };
          const parent = harness(execute, true, { cwd: home });
          parent.spawn("Child");
          const child = childHarness(execute);
          child.boundary("session_start");
          const prompt: Messages[number] = { role: "user", content: "Original task", timestamp: 1 };
          const policy: Messages[number] = {
            role: "custom",
            customType: "host-policy",
            content: "Native policy",
            display: false,
            timestamp: 2,
          };
          const transcript = [prompt, policy];
          const first = await child.context(transcript);
          const enabled = setting === "true";
          expect(first.length).toBe(transcript.length + Number(enabled) + Number(mainRead));
          if (!enabled && !mainRead) expect(first).toBe(transcript);
          expect(first.slice(-2)).toEqual(transcript);
          expect(first.slice(0, -2).every((message) => message.role === "user")).toBe(true);
          const rendered = first.slice(0, -2).map(text).join("\n");
          expect(rendered.includes("Lorelum Installed Pack Catalog")).toBe(enabled);
          expect(rendered.includes("main.read")).toBe(mainRead);
          expect(rendered).not.toContain("main-private-digest");
          expect(rendered).not.toContain("/never-expose-pack-path");
          expect(packReads).toBe(Number(enabled));
          expect(await child.context(first)).toBe(first);
          expect(packReads).toBe(Number(enabled));

          // Own get association stays on the child; successful child reads cannot become Main's.
          const command = "lore get child.read";
          const shell = await child.tool({ command, timeout: 30 });
          expect(shell?.input?.command).toContain("LORELUM_HOST_SESSION_ID='actual-child-session'");
          expect(shell?.input?.timeout).toBe(30);
          await hints.recordSuccessfulGet(
            home,
            {
              id: "child.read",
              digest: "child-digest",
              title: "Only child read",
            },
            { hostKey: "omp", sessionId: "actual-child-session" },
          );
          child.spawn("Grandchild", "eval");
          const grandchild = childHarness(execute, "Grandchild", "Child", "grandchild-session", 2);
          grandchild.boundary("session_start");
          const nested = await grandchild.context(transcript);
          const nestedMetadata = nested.slice(0, -2).map(text).join("\n");
          expect(nestedMetadata.includes("main.read")).toBe(mainRead);
          expect(nestedMetadata).not.toContain("child.read");
          expect(nestedMetadata.includes("Lorelum Installed Pack Catalog")).toBe(enabled);
          const orphan = childHarness(execute, "Orphan", "Main", "orphan-session");
          orphan.boundary("session_start");
          orphan.spawn("OrphanGrandchild");
          const orphanGrandchild = childHarness(
            execute,
            "OrphanGrandchild",
            "Orphan",
            "orphan-grandchild-session",
            2,
          );
          orphanGrandchild.boundary("session_start");
          const unboundResults = await Promise.all(
            [orphan, orphanGrandchild].map(async (unbound) => ({
              unbound,
              result: await unbound.context(transcript),
            })),
          );
          for (const { unbound, result } of unboundResults) {
            expect(result.length).toBe(transcript.length + Number(enabled));
            if (!enabled) expect(result).toBe(transcript);
            expect(result.slice(0, -2).map(text).join("\n")).not.toContain("main.read");
            expect(unbound.notify).toHaveBeenCalledTimes(0);
          }
          parent.switchSession("unrelated-parent-session");
          child.boundary("session_compact");
          const refreshed = await child.context(first);
          expect(refreshed.slice(0, -2).map(text).join("\n")).toBe(rendered);
          expect(child.notify).toHaveBeenCalledTimes(0);
          expect(grandchild.notify).toHaveBeenCalledTimes(0);
          expect(child.persist).toHaveBeenCalledTimes(0);
          expect(grandchild.persist).toHaveBeenCalledTimes(0);
          expect(transcript).toEqual([prompt, policy]);
        } finally {
          await rm(home, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("omp optional Catalog cancellation", () => {
  for (const enabled of [false, true]) {
    for (const boundary of [
      "session_compact",
      "session_switch",
      "session_shutdown",
      "conflict",
    ] as const) {
      test(`${boundary} discards stale Main hints with Catalog ${enabled}`, async () => {
        const parent = harness(async () => success);
        parent.spawn("Child");
        const gate = Promise.withResolvers<BridgeExecution>();
        let staleSignal: AbortSignal | undefined;
        let hintReads = 0;
        const execute: BridgeExecutor = async ({ request, signal }) => {
          if (request.event === "catalog") return enabled ? success : { stdout: "{}", code: 0 };
          if (request.event !== "read-hints") throw new Error("Unexpected shell request");
          if (hintReads++ === 0) {
            staleSignal = signal;
            return gate.promise;
          }
          return { stdout: JSON.stringify({ additionalContext: "Fresh Main read" }), code: 0 };
        };
        const child = childHarness(execute);
        child.boundary("session_start");
        const pending = child.context();
        if (boundary === "conflict") parent.spawn("Child", "eval");
        else if (boundary === "session_switch") child.switchSession("unrelated-child");
        else child.boundary(boundary);
        expect(staleSignal?.aborted).toBe(true);
        gate.resolve({ stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 });
        expect(await pending).toEqual([]);
        const current = await child.context();
        if (boundary === "session_compact") {
          expect(current).toHaveLength(Number(enabled) + 1);
          expect(text(current.at(-1)!)).toBe("Fresh Main read");
          expect(hintReads).toBe(2);
        } else {
          expect(current).toHaveLength(boundary === "session_shutdown" ? 0 : Number(enabled));
          expect(hintReads).toBe(1);
        }
        expect(child.notify).toHaveBeenCalledTimes(0);
        expect(child.persist).toHaveBeenCalledTimes(0);
      });
    }
  }

  test("an ancestor conflict cancels nested Main hints rather than retaining the revoked origin", async () => {
    const parent = harness(async () => success);
    parent.spawn("Child");
    const child = childHarness(async () => success);
    child.boundary("session_start");
    child.spawn("Grandchild");
    const gate = Promise.withResolvers<BridgeExecution>();
    let signal: AbortSignal | undefined;
    const execute = mock<BridgeExecutor>(async (options) => {
      if (options.request.event === "catalog") return { stdout: "{}", code: 0 };
      signal = options.signal;
      return gate.promise;
    });
    const grandchild = childHarness(execute, "Grandchild", "Child", "nested-session", 2);
    grandchild.boundary("session_start");
    const pending = grandchild.context();
    parent.spawn("Child", "eval");
    expect(signal?.aborted).toBe(true);
    gate.resolve({ stdout: JSON.stringify({ additionalContext: HINTS }), code: 0 });
    expect(await pending).toEqual([]);
    expect(await grandchild.context()).toEqual([]);
    expect(execute.mock.calls.map(([options]) => options.request)).toEqual([
      { event: "catalog", agentKind: "sub" },
      { event: "read-hints", sessionId: "actual-main-session" },
      { event: "catalog", agentKind: "sub" },
    ]);
  });
});
