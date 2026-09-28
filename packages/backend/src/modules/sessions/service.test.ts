import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sessionRefSchema, type SessionRef, type ShellToolEvent } from "./model";
import { createSessionService } from "./service";

function event(overrides: Partial<ShellToolEvent> = {}): ShellToolEvent {
  return {
    hostKey: "codex",
    event: "pre",
    toolKind: "shell",
    sessionId: "codex-session",
    toolUseId: "tool-1",
    cwd: "/workspace",
    ...overrides,
  };
}

async function temporaryDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "lorelum-sessions-")));
}

test("prefers explicit identity and uses shell windows only as a fallback", async () => {
  const directory = await temporaryDirectory();
  try {
    const sessions = createSessionService({ sessionsDirectory: join(directory, "sessions") });
    const explicit = { hostKey: "codex", sessionId: "explicit-session" } as const;

    expect(sessions.resolve("/different/worktree", explicit)).toEqual(explicit);
    await sessions.routeToolEvent(event());
    expect(sessions.resolve("/workspace/packages")).toEqual({
      hostKey: "codex",
      sessionId: "codex-session",
    });
    expect(sessions.resolve("/outside")).toBeUndefined();

    await sessions.routeToolEvent(event({ event: "post" }));
    expect(sessions.resolve("/workspace")).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses the original safe session ID as one directory component", async () => {
  const directory = await temporaryDirectory();
  try {
    const sessionsDirectory = join(directory, "sessions");
    const sessions = createSessionService({ sessionsDirectory });
    const session = { hostKey: "codex", sessionId: "codex-session-raw-id" } as const;

    expect(sessions.sessionDirectory(session)).toBe(
      join(sessionsDirectory, "codex", "codex-session-raw-id"),
    );
    for (const sessionId of ["../outside", "nested/session", "nested\\session", ".", ".."]) {
      expect(sessionRefSchema.safeParse({ hostKey: "codex", sessionId }).success).toBe(false);
    }
    expect(() =>
      sessions.sessionDirectory({
        hostKey: "codex",
        sessionId: "../outside",
      } as unknown as SessionRef),
    ).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
