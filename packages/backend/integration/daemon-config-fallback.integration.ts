import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import { createBackendSupervisor } from "../src/runtime/supervisor";
import { readRecord } from "../src/runtime/runtime-state";

const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
const home = await realpath(await mkdtemp(join(tmpdir(), "lore-backend-logging-")));
const configDirectory = join(home, ".lorelum");
const configFile = join(configDirectory, "config.yaml");
const runtimeDirectory = join(home, "runtime");
const daemonEntry = join(import.meta.dir, "daemon.ts");
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const baseUrl = `http://127.0.0.1:${reservation.port}`;
await reservation.stop(true);

process.env.HOME = home;
if (process.platform === "win32") process.env.USERPROFILE = home;

const supervisor = createBackendSupervisor({
  config: {
    runtimeDirectory,
    settings: { ...DEFAULT_BACKEND_SETTINGS, requestTimeoutMs: 3_000, shutdownTimeoutMs: 1_000 },
  },
  buildIdentity: "integration-build",
  command: [process.execPath, daemonEntry],
  runtimeDirectory,
  baseUrl,
  timeoutMs: 5_000,
});

try {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await writeFile(configFile, "logging:\n  level: noisy\n");
  const started = await supervisor.start();
  assert.equal(started.state, "ready", "logging fallback must not block daemon readiness");
  assert.equal(started.model, "unloaded", "logging acceptance must not prepare a model");
  const daemon = await readRecord(runtimeDirectory);
  assert(daemon, "The ready daemon must publish its runtime instance");

  await supervisor.stop();
  const logPath = join(runtimeDirectory, "logs", "backend", "current.jsonl");
  const records = (await readFile(logPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          source: string;
          message: string;
          level: string;
          traceId?: string;
          context?: Record<string, unknown>;
        },
    );
  const fallbackRecords = records.filter((record) => record.message === "logging.level-fallback");
  assert.equal(fallbackRecords.length, 1, "daemon startup must save exactly one fallback warning");
  assert.deepEqual(
    {
      source: fallbackRecords[0]?.source,
      level: fallbackRecords[0]?.level,
      traceId: fallbackRecords[0]?.traceId,
      instanceId: fallbackRecords[0]?.context?.instanceId,
      cause: fallbackRecords[0]?.context?.cause,
      subject: (fallbackRecords[0]?.context?.failure as { subject?: string } | undefined)?.subject,
      reason: (fallbackRecords[0]?.context?.failure as { reason?: string } | undefined)?.reason,
      fallbackLevel: fallbackRecords[0]?.context?.fallbackLevel,
      effectiveLevel: fallbackRecords[0]?.context?.effectiveLevel,
    },
    {
      source: "backend",
      level: "warn",
      traceId: undefined,
      instanceId: daemon.instanceId,
      cause: "config",
      subject: "logging.level",
      reason: "enum",
      fallbackLevel: "info",
      effectiveLevel: "info",
    },
  );
  assert.equal(
    (fallbackRecords[0]?.context?.failure as { source?: { path?: string } } | undefined)?.source
      ?.path,
    configFile,
    "the saved fact must identify the user's configuration file",
  );
  console.log(JSON.stringify({ scenario: "daemon-config-fallback", status: "passed" }));
} finally {
  await supervisor.stop().catch(() => undefined);
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  await rm(home, { recursive: true, force: true });
}
