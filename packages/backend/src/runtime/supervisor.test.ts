/* eslint-disable no-await-in-loop -- Wait for the exact test child to exit before testing recovery. */
import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  realpath,
  rm,
  stat,
  readFile,
  mkdir,
  writeFile,
  lstat,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBackendSupervisor } from "./supervisor";
import { readRecord, writeRecord } from "./runtime-state";
import { isSameProcess, processIdentity } from "./process-identity";
import { PROTOCOL_VERSION } from "../protocol/constants";
import { removeActivityRecord, setRuntimeActivity, withActivityLock } from "./activity-state";

const execute = promisify(execFile);

async function processDisplayName(pid: number): Promise<string> {
  const { stdout } = await execute("ps", ["-o", "comm=", "-p", String(pid)]);
  return stdout.trim();
}

async function fixture(
  run: (directory: string, port: number, command: readonly string[]) => Promise<void>,
) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "lorelum-backend-")));
  const directory = join(temporary, "runtime");
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("test") });
  const port = listener.port!;
  await listener.stop(true);
  const command = [
    process.execPath,
    fileURLToPath(new URL("../../integration/daemon.ts", import.meta.url)),
  ];
  try {
    await run(directory, port, command);
  } finally {
    const record = await readRecord(directory);
    if (record && (await isSameProcess(record))) {
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await controller.stop();
    }
    await removeTemporarily(temporary);
  }
}

/** Windows releases directory handles asynchronously; bounded retries avoid EBUSY flakes. */
async function removeTemporarily(directory: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 10 || !((error as NodeJS.ErrnoException).code === "EBUSY")) throw error;
      await Bun.sleep(50);
    }
  }
}

test.concurrent("status and stop of absent backend do not create runtime files", async () =>
  fixture(async (directory, port, command) => {
    const controller = createBackendSupervisor({
      buildIdentity: "integration-build",
      command,
      runtimeDirectory: directory,
      baseUrl: `http://127.0.0.1:${port}`,
    });
    expect(await controller.status()).toEqual({ state: "stopped", model: "unloaded" });
    expect(await controller.stop()).toEqual({ state: "stopped", model: "unloaded" });
    expect(await stat(directory).catch(() => undefined)).toBeUndefined();
  }));

test.concurrent(
  "concurrent starters share one daemon; a different build can stop it",
  async () =>
    fixture(async (directory, port, command) => {
      const options = {
        buildIdentity: "integration-build",
        command,
        daemonArgv0: "lore-backend",
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      };
      const controllers = Array.from({ length: 3 }, () => createBackendSupervisor(options));
      const results = await Promise.all(controllers.map((c) => c.start()));
      expect(new Set(results.map((r) => r.instanceId)).size).toBe(1);
      expect(results[0]?.state).toBe("ready");
      const record = (await readRecord(directory))!;
      expect(record.pid).not.toBe(process.pid);
      // Bun argv0 changes the macOS process display name; Linux `ps comm` keeps `bun`.
      if (process.platform === "darwin")
        expect(await processDisplayName(record.pid)).toBe("lore-backend");
      // Directory and record permission bits only exist on POSIX.
      if (process.platform !== "win32") {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
        expect((await stat(join(directory, "instance.json"))).mode & 0o777).toBe(0o600);
      }
      const mismatched = createBackendSupervisor({ ...options, buildIdentity: "different-build" });
      await expect(mismatched.status()).rejects.toMatchObject({ code: "backend.build-mismatch" });
      await expect(mismatched.start()).rejects.toMatchObject({ code: "backend.build-mismatch" });
      expect(await mismatched.stop()).toEqual({ state: "stopped", model: "unloaded" });
      expect(await isSameProcess(record)).toBe(false);
      expect(await readRecord(directory)).toBeUndefined();
      const log = await readFile(join(directory, "logs", "backend", "current.jsonl"), "utf8");
      expect(log).not.toContain(record.secret);
    }),
  20_000,
);

test.concurrent(
  "current CLI explicitly stops a verified protocol-mismatched daemon without its old CLI",
  async () =>
    fixture(async (directory, port, command) => {
      const old = createBackendSupervisor({
        buildIdentity: "integration-build",
        protocolVersion: PROTOCOL_VERSION - 1,
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await old.start();
      const record = (await readRecord(directory))!;
      const current = createBackendSupervisor({
        buildIdentity: "current-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await expect(current.status()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
      const recovery = createBackendSupervisor({
        buildIdentity: "current-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
        createClient: () => {
          throw new Error("Protocol-mismatch recovery must not call the old data plane.");
        },
      });
      expect(await recovery.stop()).toEqual({ state: "stopped", model: "unloaded" });
      expect(await isSameProcess(record)).toBe(false);
      expect(await readRecord(directory)).toBeUndefined();
    }),
  20_000,
);

test.concurrent(
  "protocol-mismatch recovery refuses a tampered native-child record without stopping either process",
  async () =>
    fixture(async (directory, port, command) => {
      const old = createBackendSupervisor({
        buildIdentity: "integration-build",
        protocolVersion: PROTOCOL_VERSION - 1,
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await old.start();
      const daemon = (await readRecord(directory))!;
      const foreign = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      try {
        await new Promise<void>((resolve, reject) => {
          foreign.once("spawn", resolve);
          foreign.once("error", reject);
        });
        if (foreign.pid === undefined) throw new Error("Test child did not receive a PID.");
        const foreignIdentity = await processIdentity(foreign.pid);
        if (foreignIdentity === undefined)
          throw new Error("Test child exited before verification.");
        await writeRecord(directory, {
          ...daemon,
          modelProcess: { ...foreignIdentity, nativeBuild: "0".repeat(64) },
        });
        const current = createBackendSupervisor({
          buildIdentity: "current-build",
          command,
          runtimeDirectory: directory,
          baseUrl: `http://127.0.0.1:${port}`,
        });
        await expect(current.stop()).rejects.toMatchObject({ code: "backend.state-invalid" });
        expect(await isSameProcess(daemon)).toBe(true);
        expect(await isSameProcess(foreignIdentity)).toBe(true);
        await writeRecord(directory, daemon);
      } finally {
        if (foreign.pid !== undefined && foreign.exitCode === null && foreign.signalCode === null) {
          foreign.kill("SIGKILL");
          await new Promise<void>((resolve) => foreign.once("close", () => resolve()));
        }
      }
    }),
  20_000,
);

test.concurrent(
  "automatic handoff stops only an idle Backend and defers active or unknown activity",
  async () =>
    fixture(async (directory, port, command) => {
      const options = {
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      };
      const owner = createBackendSupervisor(options);
      const otherBuild = createBackendSupervisor({ ...options, buildIdentity: "different-build" });
      await owner.start();
      const record = (await readRecord(directory))!;
      expect(await otherBuild.inspectCompatibilityRecovery()).toMatchObject({
        automation: "auto",
        reason: "idle",
      });

      const lease = await owner.acquireTaskLease(60_000);
      expect(await otherBuild.stopIfIdle()).toEqual({
        state: "deferred",
        reason: "active-long-task",
      });
      expect(await isSameProcess(record)).toBe(true);
      await owner.releaseTaskLease(lease.leaseId);

      await withActivityLock(directory, 1_000, () =>
        setRuntimeActivity(directory, record.instanceId, "index-operation", true),
      );
      expect(await otherBuild.stopIfIdle()).toEqual({
        state: "deferred",
        reason: "active-long-task",
      });
      await withActivityLock(directory, 1_000, () =>
        setRuntimeActivity(directory, record.instanceId, "index-operation", false),
      );

      await withActivityLock(directory, 1_000, () =>
        removeActivityRecord(directory, record.instanceId),
      );
      expect(await otherBuild.stopIfIdle()).toEqual({
        state: "deferred",
        reason: "unknown-activity",
      });
      expect(await isSameProcess(record)).toBe(true);
      await withActivityLock(directory, 1_000, () =>
        setRuntimeActivity(directory, record.instanceId, "daemon-startup", false),
      ).catch(() => undefined);
    }),
  20_000,
);

test.concurrent(
  "automatic handoff stops a verified idle Backend and cleans its activity record",
  async () =>
    fixture(async (directory, port, command) => {
      const options = {
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      };
      await createBackendSupervisor(options).start();
      const otherBuild = createBackendSupervisor({ ...options, buildIdentity: "different-build" });
      expect(await otherBuild.stopIfIdle()).toEqual({ state: "stopped" });
      expect(await readRecord(directory)).toBeUndefined();
    }),
  20_000,
);

test.concurrent(
  "crashed owned daemon leaves recoverable state and releases OS startup lock",
  async () =>
    fixture(async (directory, port, command) => {
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      const first = await controller.start();
      const record = (await readRecord(directory))!;
      process.kill(record.pid, "SIGKILL");
      for (let i = 0; i < 100 && (await isSameProcess(record)); i++) await Bun.sleep(25);
      expect(await isSameProcess(record)).toBe(false);
      expect((await controller.status()).state).toBe("stopped");
      const second = await controller.start();
      expect(second.instanceId).not.toBe(first.instanceId);
      expect(second.state).toBe("ready");
    }),
  20_000,
);

test.concurrent("an unrelated listener is neither adopted nor terminated", async () =>
  fixture(async (directory, port, command) => {
    const listener = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("other") });
    try {
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await expect(controller.start()).rejects.toMatchObject({ code: "backend.port-conflict" });
      await expect(controller.stop()).rejects.toMatchObject({ code: "backend.port-conflict" });
      expect(await (await fetch(`http://127.0.0.1:${port}`, { proxy: "" })).text()).toBe("other");
      expect(await readRecord(directory)).toBeUndefined();
    } finally {
      await listener.stop(true);
    }
  }));

test.concurrent("failed executable launch does not leave an ownership record", async () =>
  fixture(async (directory, port) => {
    const controller = createBackendSupervisor({
      buildIdentity: "integration-build",
      command: ["/nonexistent/lorelum-daemon"],
      runtimeDirectory: directory,
      baseUrl: `http://127.0.0.1:${port}`,
    });
    await expect(controller.start()).rejects.toMatchObject({ code: "backend.failed" });
    expect(await readRecord(directory)).toBeUndefined();
  }));

// This test mutates process.env, so it must not overlap lifecycle fixtures.
test(
  "daemon does not inherit unrelated CLI secrets",
  async () =>
    fixture(async (directory, port, command) => {
      const previous = process.env.LORELUM_TEST_SENTINEL;
      process.env.LORELUM_TEST_SENTINEL = "must-not-be-inherited";
      try {
        const controller = createBackendSupervisor({
          buildIdentity: "integration-build",
          command,
          runtimeDirectory: directory,
          baseUrl: `http://127.0.0.1:${port}`,
        });
        expect((await controller.start()).state).toBe("ready");
      } finally {
        if (previous === undefined) delete process.env.LORELUM_TEST_SENTINEL;
        else process.env.LORELUM_TEST_SENTINEL = previous;
      }
    }),
  20_000,
);

test.concurrent(
  "a repairable widened sink file self-heals and no longer blocks readiness",
  async () =>
    fixture(async (directory, port, command) => {
      await mkdir(directory, { mode: 0o700 });
      await mkdir(join(directory, "logs", "backend"), { recursive: true, mode: 0o700 });
      if (process.platform === "win32") {
        // No mode bits on Windows; keep the primary usable so readiness is the
        // observable outcome, and let the fallback cover the unusable case below.
        await writeFile(join(directory, "logs", "backend", "current.jsonl"), "", { mode: 0o600 });
      } else {
        await writeFile(
          join(directory, "logs", "backend", "current.jsonl"),
          "invalid-permissions",
          { mode: 0o644 },
        );
      }
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        fallbackLogDirectory: join(directory, "fallback-diagnostics"),
        baseUrl: `http://127.0.0.1:${port}`,
      });
      const status = await controller.start();
      expect(status.state).toBe("ready");
      expect(status.diagnostics?.persistence).toBe("enabled");
      if (process.platform !== "win32") {
        const sink = join(directory, "logs", "backend", "current.jsonl");
        expect((await lstat(sink)).mode & 0o077).toBe(0);
      }
      await controller.stop();
    }),
  20_000,
);

test.concurrent(
  "an unrepairable sink degrades to the designed fallback without blocking readiness",
  async () =>
    fixture(async (directory, port, command) => {
      await mkdir(directory, { mode: 0o700 });
      await mkdir(join(directory, "logs", "backend"), { recursive: true, mode: 0o700 });
      const sink = join(directory, "logs", "backend", "current.jsonl");
      const twin = join(directory, "twin.jsonl");
      if (process.platform === "win32") {
        // No mode bits or hard links to violate on Windows; a directory at the
        // sink target is unusable and not repairable.
        await mkdir(sink);
      } else {
        // A multi-linked 0644 file is neither private nor safely repairable.
        await writeFile(twin, "preserve me", { mode: 0o644 });
        await link(twin, sink);
      }
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        fallbackLogDirectory: join(directory, "fallback-diagnostics"),
        baseUrl: `http://127.0.0.1:${port}`,
      });
      const status = await controller.start();
      expect(status.state).toBe("ready");
      expect(status.diagnostics?.persistence).toBe("enabled");
      expect(status.diagnostics?.fallbackUsed).toBe(true);
      expect(status.diagnostics?.failureCategory).toBe("backend.state-invalid");
      expect(status.diagnostics?.usedDirectory).toBe(
        join(directory, "fallback-diagnostics", "backend"),
      );
      if (process.platform !== "win32") {
        expect((await lstat(sink)).mode & 0o777).toBe(0o644);
        expect(await readFile(twin, "utf8")).toBe("preserve me");
      }
      await controller.stop();
    }),
  20_000,
);

test.concurrent(
  "daemon retains its settings snapshot until restart",
  async () =>
    fixture(async (directory, port, command) => {
      const options = {
        buildIdentity: "integration-build",
        command,
        baseUrl: `http://127.0.0.1:${port}`,
      };
      const settings = { startupTimeoutMs: 8000, requestTimeoutMs: 2000, shutdownTimeoutMs: 1000 };
      const first = createBackendSupervisor({
        ...options,
        config: { runtimeDirectory: directory, settings },
      });
      await first.start();
      expect((await readRecord(directory))?.settings).toEqual(settings);
      const updated = { ...settings, shutdownTimeoutMs: 2000 };
      const next = createBackendSupervisor({
        ...options,
        config: { runtimeDirectory: directory, settings: updated },
      });
      await next.start();
      expect((await readRecord(directory))?.settings).toEqual(settings);
      await next.stop();
      await next.start();
      expect((await readRecord(directory))?.settings).toEqual(updated);
    }),
  20_000,
);

test.concurrent(
  "daemon launch record retains the resolved embedding snapshot",
  async () =>
    fixture(async (directory, port, command) => {
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
        config: {
          runtimeDirectory: directory,
          settings: { startupTimeoutMs: 10_000, requestTimeoutMs: 5_000, shutdownTimeoutMs: 5_000 },
          embedding: { modelPath: "/models/granite.gguf" },
        },
      });
      await controller.start();
      expect((await readRecord(directory))?.embedding).toMatchObject({
        modelPath: "/models/granite.gguf",
      });
    }),
  20_000,
);
