import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPracticeHintService } from "./service";
import { createSessionService } from "../sessions/service";
import type { ShellToolEvent } from "../sessions/model";
import type { ReadHint } from "./model";

function hint(id: string, title = `Title for ${id}`): ReadHint {
  return {
    id,
    digest: `digest-${id}`,
    title,
    appliesWhen: "When this fixture applies",
  };
}

function event(overrides: Partial<ShellToolEvent> = {}): ShellToolEvent {
  return {
    hostKey: "codex",
    event: "pre",
    toolKind: "shell",
    sessionId: "parent-session",
    toolUseId: "tool-1",
    cwd: "/workspace",
    ...overrides,
  };
}

async function temporaryDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "lorelum-practice-hints-")));
}

test("records only inside active shell windows and closes them on PostToolUse", async () => {
  const directory = await temporaryDirectory();
  try {
    const service = createPracticeHintService({ sessionsDirectory: join(directory, "sessions") });

    await service.recordSuccessfulGet("/workspace", hint("without-window"));
    await service.routeToolEvent(event({ toolKind: "other" }));
    await service.recordSuccessfulGet("/workspace", hint("non-shell-window"));
    expect(await service.readRecentHints("codex", "parent-session")).toEqual([]);

    await service.routeToolEvent(event());
    await service.recordSuccessfulGet("/workspace/packages", hint("recorded"));
    await service.routeToolEvent(event({ event: "post" }));
    await service.recordSuccessfulGet("/workspace", hint("after-post"));

    expect(await service.readRecentHints("codex", "parent-session")).toEqual([hint("recorded")]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expires lost windows and resolves overlapping workspaces by specificity then activity", async () => {
  const directory = await temporaryDirectory();
  try {
    let time = 1_000;
    const service = createPracticeHintService({
      sessionsDirectory: join(directory, "sessions"),
      now: () => time,
    });
    await service.routeToolEvent(event({ sessionId: "root", toolUseId: "root-tool" }));
    await service.routeToolEvent(
      event({ sessionId: "nested", toolUseId: "nested-tool", cwd: "/workspace/packages" }),
    );
    await service.recordSuccessfulGet("/workspace/packages/cli", hint("specific"));
    expect(await service.readRecentHints("codex", "nested")).toEqual([hint("specific")]);
    expect(await service.readRecentHints("codex", "root")).toEqual([]);

    time += 1;
    await service.routeToolEvent(event({ sessionId: "older", toolUseId: "older-tool" }));
    time += 1;
    await service.routeToolEvent(event({ sessionId: "newer", toolUseId: "newer-tool" }));
    await service.recordSuccessfulGet("/workspace", hint("most-recent"));
    expect(await service.readRecentHints("codex", "older")).toEqual([]);
    expect(await service.readRecentHints("codex", "newer")).toEqual([hint("most-recent")]);

    time += 30 * 60 * 1_000;
    await service.recordSuccessfulGet("/workspace", hint("expired"));
    expect(await service.readRecentHints("codex", "newer")).toEqual([hint("most-recent")]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses explicit session identity ahead of a conflicting window", async () => {
  const directory = await temporaryDirectory();
  try {
    const sessions = createSessionService({ sessionsDirectory: join(directory, "sessions") });
    const service = createPracticeHintService({ sessions });
    const explicit = { hostKey: "codex", sessionId: "explicit-session" } as const;

    await service.routeToolEvent(event({ sessionId: "window-session" }));
    await service.recordSuccessfulGet("/different/worktree", hint("explicit"), explicit);
    await service.recordSuccessfulGet("/workspace", hint("window"));

    expect(await service.readRecentHints(explicit.hostKey, explicit.sessionId)).toEqual([
      hint("explicit"),
    ]);
    expect(await service.readRecentHints("codex", "window-session")).toEqual([hint("window")]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists raw host session directories across service restart and workspace removal", async () => {
  const directory = await temporaryDirectory();
  const sessionsDirectory = join(directory, "sessions");
  const worktree = join(directory, "worktree");
  const sessionId = "codex-session-raw-id";
  try {
    await mkdir(worktree, { mode: 0o700 });
    const service = createPracticeHintService({
      sessions: createSessionService({ sessionsDirectory }),
    });
    await service.routeToolEvent(event({ sessionId, cwd: worktree }));
    await service.recordSuccessfulGet(worktree, hint("persistent"));

    const file = join(sessionsDirectory, "codex", sessionId, "practice-reads.jsonl");
    const raw = await readFile(file, "utf8");
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      hostKey: "codex",
      sessionId,
      cwd: worktree,
      hint: hint("persistent"),
    });
    expect(raw).not.toContain("prompt");
    expect(raw).not.toContain("command");
    expect(record.hint).not.toHaveProperty("packs");
    if (process.platform !== "win32") {
      expect((await stat(sessionsDirectory)).mode & 0o077).toBe(0);
      expect((await stat(join(sessionsDirectory, "codex"))).mode & 0o077).toBe(0);
      expect((await stat(join(sessionsDirectory, "codex", sessionId))).mode & 0o077).toBe(0);
      expect((await stat(file)).mode & 0o077).toBe(0);
    }

    await rm(worktree, { recursive: true, force: true });
    const restarted = createPracticeHintService({
      sessions: createSessionService({ sessionsDirectory }),
    });
    expect(await restarted.readRecentHints("codex", sessionId)).toEqual([hint("persistent")]);
    expect(await restarted.readRecentHints("cursor", sessionId)).toEqual([]);
    expect(await restarted.readRecentHints("codex", "another-session")).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("appends hundreds of reads without a fixed-size cutoff", async () => {
  const directory = await temporaryDirectory();
  try {
    const sessionsDirectory = join(directory, "sessions");
    const service = createPracticeHintService({ sessionsDirectory });
    await service.routeToolEvent(event());
    for (let index = 0; index < 300; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- Keep this multi-hundred-turn persistence probe sequential.
      await service.recordSuccessfulGet("/workspace", hint(`practice-${index}`, "x".repeat(1_200)));
    }

    const path = join(sessionsDirectory, "codex", "parent-session", "practice-reads.jsonl");
    expect((await stat(path)).size).toBeGreaterThan(256 * 1024);
    const recent = await service.readRecentHints("codex", "parent-session");
    expect(recent).toHaveLength(100);
    expect(recent[0]).toEqual(hint("practice-299", "x".repeat(100)));
    expect(recent[99]?.id).toBe("practice-200");
    expect(Buffer.byteLength(JSON.stringify(recent), "utf8")).toBeLessThanOrEqual(262_144);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps oversized metadata within the authenticated client response bound", async () => {
  const directory = await temporaryDirectory();
  try {
    const service = createPracticeHintService({ sessionsDirectory: join(directory, "sessions") });
    await service.routeToolEvent(event());
    const ids: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const id = `${String(index).padStart(3, "0")}-${"😀".repeat(510)}`;
      ids.push(id);
      // eslint-disable-next-line no-await-in-loop -- Exercise the bounded read after sequential successful reports.
      await service.recordSuccessfulGet("/workspace", {
        id,
        digest: "d".repeat(256),
        title: "t".repeat(100),
        appliesWhen: "a".repeat(120),
      });
    }

    const recent = await service.readRecentHints("codex", "parent-session");
    expect(recent.length).toBeGreaterThan(0);
    expect(recent).toHaveLength(100);
    expect(recent[0]?.id).toBe(ids[ids.length - 1]);
    expect(Buffer.byteLength(JSON.stringify(recent), "utf8")).toBeLessThanOrEqual(262_144);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("skips a damaged trailing line and keeps later appends readable", async () => {
  const directory = await temporaryDirectory();
  try {
    const sessionsDirectory = join(directory, "sessions");
    const service = createPracticeHintService({ sessionsDirectory });
    await service.routeToolEvent(event());
    await service.recordSuccessfulGet("/workspace", hint("before-corruption"));
    const path = join(sessionsDirectory, "codex", "parent-session", "practice-reads.jsonl");
    await appendFile(path, '{"incomplete":', "utf8");

    expect(await service.readRecentHints("codex", "parent-session")).toEqual([
      hint("before-corruption"),
    ]);
    await service.recordSuccessfulGet("/workspace", hint("after-corruption"));
    expect(await service.readRecentHints("codex", "parent-session")).toEqual([
      hint("after-corruption"),
      hint("before-corruption"),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
