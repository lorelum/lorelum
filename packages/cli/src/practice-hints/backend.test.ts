import { expect, test } from "bun:test";
import type { ReadHint, ShellToolEvent } from "@lorelum/backend/client";

import { createOptionalPracticeHints } from "./backend.js";

const hint: ReadHint = {
  id: "sample.read",
  digest: "digest",
  title: "Read a Practice",
};
const event: ShellToolEvent = {
  hostKey: "codex",
  event: "pre",
  toolKind: "shell",
  sessionId: "parent",
  toolUseId: "tool",
  cwd: "/work",
};

function clearSessionEnvironment(): () => void {
  const previousHostKey = process.env.LORELUM_HOST_KEY;
  const previousSessionId = process.env.LORELUM_HOST_SESSION_ID;
  delete process.env.LORELUM_HOST_KEY;
  delete process.env.LORELUM_HOST_SESSION_ID;
  return () => {
    if (previousHostKey === undefined) delete process.env.LORELUM_HOST_KEY;
    else process.env.LORELUM_HOST_KEY = previousHostKey;
    if (previousSessionId === undefined) delete process.env.LORELUM_HOST_SESSION_ID;
    else process.env.LORELUM_HOST_SESSION_ID = previousSessionId;
  };
}

test("forwards shell events and successful reads to a connected Backend", async () => {
  const restoreSessionEnvironment = clearSessionEnvironment();
  const calls: unknown[] = [];
  try {
    const hints = createOptionalPracticeHints(async () => ({
      async routeToolEvent(value, options) {
        calls.push(["tool", value, options?.deadline]);
      },
      async recordSuccessfulGet(cwd, value, session, options) {
        calls.push(["get", cwd, value, session, options?.deadline]);
      },
      async readRecentHints(hostKey, sessionId, options) {
        calls.push(["read", hostKey, sessionId, options?.deadline]);
        return [hint];
      },
    }));
    await hints.routeToolEvent(event);
    await hints.recordSuccessfulGet("/work/src", hint);
    expect(await hints.readRecentHints("codex", "parent")).toEqual([hint]);
  } finally {
    restoreSessionEnvironment();
  }
  expect(calls.map((call) => (call as unknown[])[0])).toEqual(["tool", "get", "read"]);
  expect((calls[1] as unknown[]).slice(1, 4)).toEqual(["/work/src", hint, undefined]);
  for (const call of calls) {
    expect((call as unknown[]).at(-1)).toBeGreaterThan(Date.now() - 350);
  }
});

test("non-shell tools and missing Backend never interrupt host work", async () => {
  let connections = 0;
  const hints = createOptionalPracticeHints(async () => {
    connections += 1;
    throw new Error("Backend unavailable");
  });
  await hints.routeToolEvent({ ...event, toolKind: "other" });
  expect(connections).toBe(0);
  await expect(hints.routeToolEvent(event)).resolves.toBeUndefined();
  await expect(hints.recordSuccessfulGet("/work", hint)).resolves.toBeUndefined();
  await expect(hints.readRecentHints("codex", "parent")).resolves.toEqual([]);
  expect(connections).toBe(3);
});

test("passes only a complete SessionRef validated by the shared schema", async () => {
  const restoreSessionEnvironment = clearSessionEnvironment();
  const sessions: (unknown | undefined)[] = [];
  const hints = createOptionalPracticeHints(async () => ({
    async routeToolEvent() {},
    async recordSuccessfulGet(_cwd, _value, session) {
      sessions.push(session);
    },
    async readRecentHints() {
      return [];
    },
  }));

  try {
    process.env.LORELUM_HOST_KEY = "codex";
    process.env.LORELUM_HOST_SESSION_ID = "parent-session";
    await hints.recordSuccessfulGet("/work", hint);

    process.env.LORELUM_HOST_SESSION_ID = "";
    await hints.recordSuccessfulGet("/work", hint);

    process.env.LORELUM_HOST_KEY = "unsupported-host";
    process.env.LORELUM_HOST_SESSION_ID = "parent-session";
    await hints.recordSuccessfulGet("/work", hint);

    delete process.env.LORELUM_HOST_KEY;
    await hints.recordSuccessfulGet("/work", hint);
  } finally {
    restoreSessionEnvironment();
  }

  expect(sessions).toEqual([
    { hostKey: "codex", sessionId: "parent-session" },
    undefined,
    undefined,
    undefined,
  ]);
});
