import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PI_CATALOG_CONTEXT_LIMIT,
  PI_CATALOG_STDERR_LIMIT_BYTES,
  PI_CATALOG_STDOUT_LIMIT_BYTES,
  PI_CATALOG_TIMEOUT_MS,
  parsePiCatalogResponse,
  readPiCatalog,
  type CatalogChildProcess,
  type CatalogProcessSpawner,
} from "./cli-catalog.ts";

class FakeStdin extends EventEmitter {
  payload = "";

  write(chunk: string): boolean {
    this.payload += chunk;
    return true;
  }

  end(): void {}
}

class FakeChild extends EventEmitter {
  readonly pid: number | undefined;
  readonly stdin = new FakeStdin();
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly signals: NodeJS.Signals[] = [];

  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }

  get childProcess(): CatalogChildProcess {
    return this as unknown as CatalogChildProcess;
  }

  emitStdout(data: string): void {
    this.stdout.emit("data", Buffer.from(data, "utf8"));
  }

  emitStderr(data: string): void {
    this.stderr.emit("data", Buffer.from(data, "utf8"));
  }

  emitClose(code: number | null): void {
    this.emit("close", code, null);
  }

  emitError(code: string): void {
    this.emit("error", Object.assign(new Error(code), { code }));
  }

  emitStdinError(): void {
    this.stdin.emit("error", new Error("EPIPE"));
  }
}

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

function scripted(children: readonly FakeChild[]): {
  readonly calls: SpawnCall[];
  readonly spawn: CatalogProcessSpawner;
} {
  const calls: SpawnCall[] = [];
  const spawn: CatalogProcessSpawner = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    const child = children[calls.length - 1];
    if (child === undefined) throw new Error(`Unexpected spawn of ${command}`);
    return child.childProcess;
  };
  return { calls, spawn };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("readPiCatalog process adapter", () => {
  test("uses the documented budgets as its defaults", () => {
    expect(PI_CATALOG_TIMEOUT_MS).toBe(5_000);
    expect(PI_CATALOG_STDOUT_LIMIT_BYTES).toBe(16 * 1024);
    expect(PI_CATALOG_STDERR_LIMIT_BYTES).toBe(8 * 1024);
    expect(PI_CATALOG_CONTEXT_LIMIT).toBe(4_000);
  });

  test("runs the fixed lore hook pi argv and pipes the lifecycle payload on stdin", async () => {
    const child = new FakeChild(4242);
    const { calls, spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ command: "lore", args: ["hook", "pi"], cwd: "/work", env: {} });
    expect(child.stdin.payload).toBe('{"hook_event_name":"session_start"}');

    child.emitStdout(JSON.stringify({ additionalContext: "Lorelum Installed Pack Catalog" }));
    child.emitClose(0);

    await expect(pending).resolves.toEqual({
      status: "catalog",
      catalog: "Lorelum Installed Pack Catalog",
    });
  });

  test("sends the compact lifecycle event for session_compact", async () => {
    const child = new FakeChild(1);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_compact", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );

    expect(child.stdin.payload).toBe('{"hook_event_name":"session_compact"}');
    child.emitStdout(JSON.stringify({ additionalContext: "Catalog" }));
    child.emitClose(0);
    await expect(pending).resolves.toEqual({ status: "catalog", catalog: "Catalog" });
  });

  test("falls back to the fixed lore.cmd shim on Windows only when the executable is missing", async () => {
    const first = new FakeChild(undefined);
    const second = new FakeChild(9001);
    const { calls, spawn } = scripted([first, second]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "C:\\work" },
      { spawn, platform: "win32", env: {}, comSpec: "cmd.exe" },
    );

    first.emitError("ENOENT");
    await tick();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "where.exe /q lore.cmd || exit /b 9009 & lore.cmd hook pi"],
      cwd: "C:\\work",
      env: {},
    });

    second.emitStdout(JSON.stringify({ additionalContext: "Catalog" }));
    second.emitClose(0);
    await expect(pending).resolves.toEqual({ status: "catalog", catalog: "Catalog" });
  });

  test("does not fall back on POSIX or after a non-zero exit", async () => {
    const posix = new FakeChild(undefined);
    const posixRun = scripted([posix]);
    const posixPending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn: posixRun.spawn, platform: "linux", env: {} },
    );
    posix.emitError("ENOENT");
    await expect(posixPending).resolves.toEqual({ status: "unavailable", kind: "cli-missing" });
    expect(posixRun.calls).toHaveLength(1);

    const failed = new FakeChild(2);
    const failedRun = scripted([failed]);
    const failedPending = readPiCatalog(
      { event: "session_start", cwd: "C:\\work" },
      { spawn: failedRun.spawn, platform: "win32", env: {} },
    );
    failed.emitClose(3);
    await expect(failedPending).resolves.toEqual({ status: "unavailable", kind: "cli-error" });
    expect(failedRun.calls).toHaveLength(1);
  });

  test("reports cli-missing when cmd.exe is also absent", async () => {
    const first = new FakeChild(undefined);
    const second = new FakeChild(undefined);
    const { spawn } = scripted([first, second]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "C:\\work" },
      { spawn, platform: "win32", env: {} },
    );
    first.emitError("ENOENT");
    await tick();
    second.emitError("ENOENT");
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "cli-missing" });
  });

  test.each([
    [9009, "cli-missing"],
    [1, "cli-error"],
  ] as const)(
    "distinguishes a missing Windows shim from an installed CLI failure (%i)",
    async (exitCode, kind) => {
      const first = new FakeChild(undefined);
      const shell = new FakeChild(123);
      const { spawn } = scripted([first, shell]);
      const pending = readPiCatalog(
        { event: "session_start", cwd: "C:\\work" },
        { spawn, platform: "win32", env: {}, comSpec: "cmd.exe" },
      );
      first.emitError("ENOENT");
      // The shell starts successfully; only its command lookup fails.
      await tick();
      shell.emitClose(exitCode);
      await expect(pending).resolves.toEqual({ status: "unavailable", kind });
    },
  );

  test("stops waiting and kills the child at the deadline", async () => {
    const child = new FakeChild(777);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {}, timeoutMs: 5 },
    );

    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "timeout" });
    expect(child.signals).toEqual(["SIGKILL"]);
  });

  test("terminates the whole shim tree on a Windows deadline", async () => {
    const first = new FakeChild(undefined);
    const second = new FakeChild(5555);
    const killed: number[] = [];
    const { spawn } = scripted([first, second]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "C:\\work" },
      { spawn, platform: "win32", env: {}, timeoutMs: 5, runKillTree: (pid) => killed.push(pid) },
    );
    first.emitError("ENOENT");

    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "timeout" });
    expect(killed).toEqual([5555]);
    expect(second.signals).toEqual([]);
  });

  test("honours an aborted request and cleans up the child", async () => {
    const controller = new AbortController();
    const child = new FakeChild(11);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work", signal: controller.signal },
      { spawn, platform: "linux", env: {} },
    );

    controller.abort();
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "cancelled" });
    expect(child.signals).toEqual(["SIGKILL"]);
  });

  test("rejects an already-aborted request without waiting", async () => {
    const controller = new AbortController();
    controller.abort();
    const child = new FakeChild(12);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work", signal: controller.signal },
      { spawn, platform: "linux", env: {} },
    );

    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "cancelled" });
    expect(child.signals).toEqual(["SIGKILL"]);
  });

  test("settles a stdin write failure as a CLI error without hanging", async () => {
    const child = new FakeChild(13);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );

    child.emitStdinError();
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "cli-error" });
    expect(child.signals).toEqual(["SIGKILL"]);
  });

  test("settles once when a spawn error races an exit", async () => {
    const child = new FakeChild(undefined);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );

    child.emitError("ENOENT");
    child.emitClose(0);
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "cli-missing" });
  });

  test("keeps the timeout result when a close arrives afterwards", async () => {
    const child = new FakeChild(14);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {}, timeoutMs: 5 },
    );

    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "timeout" });
    child.emitClose(0);
    // The settled result is immutable; a late close must not resolve or reject again.
    await tick();
    expect(child.signals).toEqual(["SIGKILL"]);
  });

  test("late stdin errors do not kill a child after a successful close", async () => {
    const child = new FakeChild(42);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );
    child.emitStdout('{"additionalContext":"Catalog"}');
    child.emitClose(0);
    await expect(pending).resolves.toEqual({ status: "catalog", catalog: "Catalog" });
    child.emitStdinError();
    expect(child.signals).toEqual([]);
  });

  test("an unsupported CLI gives an update action rather than a Store diagnosis", async () => {
    const child = new FakeChild(43);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );
    child.emitStderr("usage.invalid: Unknown command hook pi");
    child.emitClose(2);
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "cli-unsupported" });
  });

  test("a failed Windows tree termination falls back without throwing into Pi", async () => {
    const first = new FakeChild(undefined);
    const second = new FakeChild(44);
    const { spawn } = scripted([first, second]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "C:\\work" },
      {
        spawn,
        platform: "win32",
        env: {},
        timeoutMs: 5,
        runKillTree: (_pid, onFailure) => onFailure(),
      },
    );
    first.emitError("ENOENT");
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "timeout" });
    expect(second.signals).toEqual(["SIGKILL"]);
  });

  test("treats a legacy {} envelope as unavailable, not an empty Store", async () => {
    const child = new FakeChild(16);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );

    child.emitStdout("{}");
    child.emitClose(0);
    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "invalid-response" });
  });

  test("rejects oversized stdout and keeps draining stderr", async () => {
    const child = new FakeChild(15);
    const { spawn } = scripted([child]);
    const pending = readPiCatalog(
      { event: "session_start", cwd: "/work" },
      { spawn, platform: "linux", env: {} },
    );

    child.emitStdout("x".repeat(PI_CATALOG_STDOUT_LIMIT_BYTES + 1));
    child.emitStderr("e".repeat(PI_CATALOG_STDERR_LIMIT_BYTES + 1));
    child.emitClose(0);

    await expect(pending).resolves.toEqual({ status: "unavailable", kind: "invalid-response" });
  });

  test.skipIf(process.platform === "win32" || Bun.which("sh") === null)(
    "finds the released lore CLI through PATH",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "lorelum-pi-cli-"));
      const lore = join(directory, "lore");
      await writeFile(
        lore,
        [
          "#!/bin/sh",
          'input="$(cat)"',
          `if [ "$input" != '{"hook_event_name":"session_start"}' ]; then exit 2; fi`,
          "printf '%s\\n' '{\"additionalContext\":\"Lorelum Installed Pack Catalog\"}'",
          "",
        ].join("\n"),
        "utf8",
      );
      await chmod(lore, 0o755);

      try {
        const result = await readPiCatalog(
          { event: "session_start", cwd: directory },
          {
            platform: process.platform,
            env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
          },
        );
        expect(result.status).toBe("catalog");
        if (result.status === "catalog") {
          expect(result.catalog).toContain("Lorelum Installed Pack Catalog");
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("parsePiCatalogResponse", () => {
  test("accepts only a non-empty, bounded additionalContext envelope", () => {
    expect(parsePiCatalogResponse('{"additionalContext":"Catalog"}')).toEqual({
      ok: true,
      catalog: "Catalog",
    });
    expect(
      parsePiCatalogResponse(
        '{"additionalContext":"No installed Knowledge Packs are currently available."}',
      ),
    ).toEqual({ ok: true, catalog: "No installed Knowledge Packs are currently available." });
    expect(parsePiCatalogResponse("{}")).toEqual({ ok: false });
    expect(parsePiCatalogResponse('{"additionalContext":""}')).toEqual({ ok: false });
    expect(parsePiCatalogResponse('{"additionalContext":42}')).toEqual({ ok: false });
    expect(parsePiCatalogResponse("[]")).toEqual({ ok: false });
    expect(parsePiCatalogResponse("not json")).toEqual({ ok: false });
    expect(
      parsePiCatalogResponse(`{"additionalContext":"${"a".repeat(PI_CATALOG_CONTEXT_LIMIT + 1)}"}`),
    ).toEqual({ ok: false });
  });
});
