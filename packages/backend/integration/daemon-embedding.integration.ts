/* eslint-disable no-await-in-loop -- This explicit real-process acceptance follows one owned process at a time. */
import { strict as assert } from "node:assert";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBackendSupervisor } from "../src/runtime/supervisor";
import { createBackendClient } from "../src/client/client";
import { readRecord } from "../src/runtime/runtime-state";
import { isSameProcess, type ProcessIdentity } from "../src/runtime/process-identity";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";

if (!process.argv[2]) throw new Error("Provide the fixed Q4_0 model path");
const home = await realpath(await mkdtemp(join(tmpdir(), "lore-model-daemon-")));
const runtimeDirectory = join(home, "runtime");
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const baseUrl = `http://127.0.0.1:${reservation.port}`;
await reservation.stop(true);
const supervisor = createBackendSupervisor({
  config: {
    runtimeDirectory,
    settings: { ...DEFAULT_BACKEND_SETTINGS, requestTimeoutMs: 100 },
    embedding: { modelPath: resolve(process.argv[2]) },
  },
  command: [process.execPath, join(import.meta.dir, "daemon.ts")],
  buildIdentity: "integration-build",
  baseUrl,
});
async function waitGone(identity: ProcessIdentity) {
  const deadline = Date.now() + 5000;
  while (await isSameProcess(identity)) {
    assert(Date.now() < deadline, "Owned native process survived its deadline");
    await Bun.sleep(20);
  }
}
let native: ProcessIdentity | undefined;
try {
  await supervisor.start();
  const record = (await readRecord(runtimeDirectory))!;
  const client = createBackendClient({
    identity: record,
    secret: record.secret,
    buildIdentity: "integration-build",
    baseUrl,
    timeoutMs: 2000,
  });
  await client.loadModel();
  native = (await readRecord(runtimeDirectory))!.modelProcess!;
  assert(native?.pid);
  await client.embed("query", ["first"]);
  await client.embed("query", ["second"]);
  assert.equal((await readRecord(runtimeDirectory))!.modelProcess!.pid, native.pid);
  await assert.rejects(client.embed("document", Array<string>(8).fill("hello ".repeat(509))), {
    code: "embedding.deadline-exceeded",
  });
  await waitGone(native);
  assert.equal((await client.statusModel()).state, "failed");
  assert.equal((await client.status()).state, "ready");
  await client.loadModel();
  native = (await readRecord(runtimeDirectory))!.modelProcess!;
  process.kill(native.pid, "SIGKILL");
  await waitGone(native);
  for (let attempt = 0; attempt < 100 && (await client.statusModel()).state !== "failed"; attempt++)
    await Bun.sleep(10);
  assert.equal((await client.statusModel()).state, "failed");
  await client.loadModel();
  native = (await readRecord(runtimeDirectory))!.modelProcess!;
  process.kill(record.pid, "SIGKILL");
  await waitGone(record);
  await waitGone(native);
  await supervisor.start();
  assert.equal((await supervisor.status()).model, "unloaded");
  await supervisor.stop();
  assert.equal(await readRecord(runtimeDirectory), undefined);
  console.log(
    JSON.stringify({
      status: "passed",
      residentReuse: true,
      timeoutRecycled: true,
      crashRecovered: true,
      parentDeathRecycled: true,
      restartClean: true,
    }),
  );
} finally {
  await supervisor.stop();
  if (native && (await isSameProcess(native))) {
    process.kill(native.pid, "SIGKILL");
    await waitGone(native);
  }
  await rm(home, { recursive: true, force: true });
}
