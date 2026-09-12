/* eslint-disable no-await-in-loop -- Scenarios share one real native slot. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createBackendApp } from "../src/app";
import { createBackendClient } from "../src/client/client";
import { createBackendService } from "../src/modules/backend/service";
import { PROTOCOL_VERSION } from "../src/protocol/constants";
import {
  assertUnitVector,
  createNativeFixture,
  HARNESS_ENCODE_BUDGET_MS,
  modelPathFromArgs,
} from "./support/native";
import { readRssMiB, waitUntil } from "./support/process";
import { verifyReferences } from "./support/reference";

let beforeEncode: (() => Promise<void>) | undefined;
const fixture = createNativeFixture(modelPathFromArgs(), { beforeEncode: () => beforeEncode?.() });
const identity = {
  instanceId: "integration",
  buildIdentity: "integration",
  protocolVersion: PROTOCOL_VERSION,
};
const secret = "integration-only";
const app = createBackendApp({
  backend: createBackendService({
    identity,
    secret,
    modelState: () => fixture.service.status().state,
    onStop: () => fixture.service.unload().then(() => {}),
  }),
  embedding: fixture.service,
  port: 0,
  queryService: {
    async query() {
      return { mode: "keyword", results: [] };
    },
  },
});
try {
  app.listen({ hostname: "127.0.0.1", port: 0 });
  assert(app.server, "Integration HTTP server must be listening");
  const client = createBackendClient({
    identity,
    secret,
    buildIdentity: identity.buildIdentity,
    baseUrl: `http://127.0.0.1:${app.server.port}`,
    timeoutMs: HARNESS_ENCODE_BUDGET_MS,
  });
  assert.equal((await client.statusModel()).state, "unloaded");
  const started = performance.now();
  assert.equal((await client.loadModel()).state, "ready");
  const loadMs = performance.now() - started;
  const readyRssMiB = await readRssMiB(fixture.process);

  if (process.argv[3]) await verifyReferences(client, resolve(process.argv[3]));
  const samples = await sampleEncoding(client);
  const statusWhileBusyMs = await verifyBusyAdmission(client);
  const workloadRssMiB = await readRssMiB(fixture.process);
  await verifyReloadCycles(client);
  console.log(
    JSON.stringify({
      scenario: "http-embedding",
      status: "passed",
      cycles: 3,
      observations: { loadMs, readyRssMiB, workloadRssMiB, ...samples, statusWhileBusyMs },
    }),
  );
} finally {
  try {
    await fixture.service.unload();
  } finally {
    await app.stop(true);
  }
}

type Client = ReturnType<typeof createBackendClient>;
const sampleText = "semantic index integration sample";

/** Observations only; functional acceptance does not assert a machine-specific performance target. */
async function sampleEncoding(client: Client) {
  const times: number[] = [];
  const sampleCount = 20;
  for (let index = 0; index < sampleCount; index++) {
    const started = performance.now();
    const result = await client.embed("document", [sampleText]);
    times.push(performance.now() - started);
    assert.equal(result.vectors.length, 1);
    assertUnitVector(result.vectors[0]);
  }
  times.sort((a, b) => a - b);
  return {
    sampleCount,
    documentsPerSecond: (sampleCount * 1000) / times.reduce((a, b) => a + b, 0),
    p95Ms: times[Math.ceil(sampleCount * 0.95) - 1],
  };
}

async function verifyBusyAdmission(client: Client) {
  let entered = false;
  let release = () => {};
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  beforeEncode = async () => {
    entered = true;
    await gate;
  };
  const batch = client.embed("document", Array<string>(8).fill("busy"));
  // Observe settlement immediately so a request failure cannot become an unhandled rejection.
  const settled = batch.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  let statusMs = 0;
  try {
    await waitUntil("batch to enter the encoding slot", async () => entered);
    const started = performance.now();
    assert.equal(
      (await client.status()).state,
      "ready",
      "Control API must respond while encoding is occupied",
    );
    statusMs = performance.now() - started;
    await assert.rejects(client.embed("query", ["busy"]), { code: "embedding.busy" });
  } finally {
    beforeEncode = undefined;
    release();
    await settled;
  }
  const outcome = await settled;
  if ("error" in outcome) throw outcome.error;
  assert.equal(outcome.result.vectors.length, 8, "Released batch must complete");
  return statusMs;
}

async function verifyReloadCycles(client: Client) {
  assert.equal((await client.unloadModel()).state, "unloaded");
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.equal((await client.loadModel()).state, "ready");
    const result = await client.embed("query", ["原文保持不变。", "code example"]);
    assert.equal(result.vectors.length, 2);
    result.vectors.forEach(assertUnitVector);
    assert.equal((await client.unloadModel()).state, "unloaded");
  }
}
