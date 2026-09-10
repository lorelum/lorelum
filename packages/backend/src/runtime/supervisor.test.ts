/* eslint-disable no-await-in-loop -- Wait for the exact test child to exit before testing recovery. */
import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendSupervisor } from "./supervisor";
import { readRecord } from "./runtime-state";
import { isSameProcess } from "./process-identity";

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
    new URL("../../integration/daemon.ts", import.meta.url).pathname,
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
    await rm(temporary, { recursive: true, force: true });
  }
}

test("status and stop of absent backend do not create runtime files", async () =>
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

test(
  "concurrent starters share one daemon; compatible controller stops an older build",
  async () =>
    fixture(async (directory, port, command) => {
      const options = {
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      };
      const controllers = Array.from({ length: 3 }, () => createBackendSupervisor(options));
      const results = await Promise.all(controllers.map((c) => c.start()));
      expect(new Set(results.map((r) => r.instanceId)).size).toBe(1);
      expect(results[0]?.state).toBe("ready");
      const record = (await readRecord(directory))!;
      expect(record.pid).not.toBe(process.pid);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, "instance.json"))).mode & 0o777).toBe(0o600);
      const upgraded = createBackendSupervisor({ ...options, buildIdentity: "new-build" });
      expect((await upgraded.status()).buildIdentity).toBe("integration-build");
      await expect(upgraded.start()).rejects.toMatchObject({ code: "backend.incompatible" });
      expect(await upgraded.stop()).toEqual({ state: "stopped", model: "unloaded" });
      expect(await isSameProcess(record)).toBe(false);
      expect(await readRecord(directory)).toBeUndefined();
      const log = await readFile(join(directory, "backend.log"), "utf8");
      expect(log).not.toContain(record.secret);
    }),
  20_000,
);

test(
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

test("an unrelated listener is neither adopted nor terminated", async () =>
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

test("failed executable launch does not leave an ownership record", async () =>
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

test(
  "failure after bind cannot be reported as a ready service",
  async () =>
    fixture(async (directory, port, command) => {
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, "backend.log"), "invalid-permissions", { mode: 0o644 });
      const controller = createBackendSupervisor({
        buildIdentity: "integration-build",
        command,
        runtimeDirectory: directory,
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await expect(controller.start()).rejects.toBeInstanceOf(Error);
      expect(await readRecord(directory)).toBeUndefined();
      expect((await controller.status()).state).toBe("stopped");
    }),
  20_000,
);

test(
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
