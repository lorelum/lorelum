import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendSupervisor } from "../src/runtime/supervisor";
import { createBackendClient, type BackendClient } from "../src/client/client";
import { readRecord } from "../src/runtime/runtime-state";
import { isSameProcess, type ProcessIdentity } from "../src/runtime/process-identity";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import { modelPathFromArgs } from "./support/native";
import { waitUntil, waitForProcessExit } from "./support/process";

const modelPath = modelPathFromArgs();
const home = await realpath(await mkdtemp(join(tmpdir(), "lore-model-daemon-")));
const runtimeDirectory = join(home, "runtime");
// The supervisor currently requires a port before launch. A bind conflict fails explicitly.
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const baseUrl = `http://127.0.0.1:${reservation.port}`;
await reservation.stop(true);
const buildIdentity = "integration-build";
const supervisor = createBackendSupervisor({
  config: {
    runtimeDirectory,
    embedding: { modelPath },
    settings: { ...DEFAULT_BACKEND_SETTINGS, requestTimeoutMs: 100, shutdownTimeoutMs: 1000 },
  },
  command: [process.execPath, join(import.meta.dir, "daemon.ts")],
  buildIdentity,
  baseUrl,
});
let native: ProcessIdentity | undefined;
try {
  await supervisor.start();
  const daemon = await readRecord(runtimeDirectory);
  assert(daemon, "Started daemon must publish its runtime record");
  const client = createBackendClient({
    identity: daemon,
    secret: daemon.secret,
    buildIdentity,
    baseUrl,
    timeoutMs: 3000,
  });
  await verifyResidentReuse(client);
  await verifyUnresponsiveNativeRecovery(client);
  await verifyNativeCrashRecovery(client);
  await verifyDaemonCrashRecovery(client, daemon);
  console.log(
    JSON.stringify({
      scenario: "daemon-lifecycle",
      status: "passed",
      residentReuse: true,
      timeoutRecycled: true,
      crashRecovered: true,
      parentDeathRecycled: true,
      restartClean: true,
    }),
  );
} finally {
  try {
    await supervisor.stop();
  } finally {
    try {
      if (native && (await isSameProcess(native))) {
        process.kill(native.pid, "SIGKILL");
        await waitForProcessExit(native);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
}

async function nativeIdentity(): Promise<ProcessIdentity> {
  const record = await readRecord(runtimeDirectory);
  assert(record?.modelProcess, "Loaded model must publish its native process identity");
  native = record.modelProcess;
  return native;
}
async function verifyResidentReuse(client: BackendClient) {
  await client.loadModel();
  const first = await nativeIdentity();
  await client.embed("query", ["first"]);
  await client.embed("query", ["second"]);
  assert.deepEqual(
    await nativeIdentity(),
    first,
    "Encoding requests must reuse the native process",
  );
}
async function verifyUnresponsiveNativeRecovery(client: BackendClient) {
  const blocked = await nativeIdentity();
  // A stopped process cannot answer: the timeout no longer depends on CPU speed or batch size.
  process.kill(blocked.pid, "SIGSTOP");
  await assert.rejects(client.embed("query", ["blocked native request"]), {
    code: "embedding.deadline-exceeded",
  });
  await waitForProcessExit(blocked);
  assert.equal((await client.statusModel()).state, "failed", "Native timeout must fail the model");
  assert.equal(
    (await client.status()).state,
    "ready",
    "Native failure must leave control service usable",
  );
}
async function verifyNativeCrashRecovery(client: BackendClient) {
  await client.loadModel();
  const crashed = await nativeIdentity();
  process.kill(crashed.pid, "SIGKILL");
  await waitForProcessExit(crashed);
  await waitUntil(
    "model crash to be reported",
    async () => (await client.statusModel()).state === "failed",
  );
}
async function verifyDaemonCrashRecovery(client: BackendClient, daemon: ProcessIdentity) {
  assert.equal((await client.loadModel()).state, "ready", "Model must recover after native crash");
  const child = await nativeIdentity();
  process.kill(daemon.pid, "SIGKILL");
  await waitForProcessExit(daemon);
  await waitForProcessExit(child);
  assert.equal(
    (await supervisor.start()).model,
    "unloaded",
    "Restart must begin with an unloaded model",
  );
  await supervisor.stop();
  assert.equal(
    await readRecord(runtimeDirectory),
    undefined,
    "Stop must clear the owned runtime record",
  );
}
