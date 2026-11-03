/* eslint-disable no-await-in-loop -- One isolated daemon owns sequential workload and bounded idle observations. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createBackendSupervisor } from "../src/runtime/supervisor";
import { createBackendClient, type BackendClient } from "../src/client/client";
import { readRecord, type RuntimeRecord } from "../src/runtime/runtime-state";
import { isSameProcess, type ProcessIdentity } from "../src/runtime/process-identity";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import { assertUnitVector, modelPathFromArgs } from "./support/native";
import { readRssMiB, waitUntil, waitForProcessExit } from "./support/process";

// footprint is a macOS physical-memory measurement, not interchangeable with RSS.
assert.equal(process.platform, "darwin", "Idle memory acceptance requires macOS footprint");
const modelPath = modelPathFromArgs();
const home = await realpath(await mkdtemp(join(tmpdir(), "lore-idle-memory-")));
const runtimeDirectory = join(home, "runtime");
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const baseUrl = `http://127.0.0.1:${reservation.port}`;
await reservation.stop(true);
const supervisor = createBackendSupervisor({
  config: {
    runtimeDirectory,
    embedding: { modelPath, cacheDirectory: join(home, "models"), download: { enabled: false } },
    settings: DEFAULT_BACKEND_SETTINGS,
  },
  command: [process.execPath, join(import.meta.dir, "daemon.ts")],
  buildIdentity: "integration-build",
  baseUrl,
});
const execFileAsync = promisify(execFile);
type NativeIdentity = NonNullable<RuntimeRecord["modelProcess"]>;
type MemorySample = {
  phase: string;
  elapsedMs: number;
  footprintMiB: number;
  rssMiB: number;
};
const started = performance.now();
const memory: MemorySample[] = [];
const latencies: { phase: string; durationMs: number }[] = [];
const ownedNative: NativeIdentity[] = [];
let daemon: ProcessIdentity | undefined;
let passed = false;
let evidence: Record<string, unknown> = {};
try {
  await supervisor.start();
  const record = await readRecord(runtimeDirectory);
  assert(record, "Isolated daemon must publish its ownership record");
  daemon = record;
  // No timeout override: the real Backend and client both retain the product 5 s budget.
  const client = createBackendClient({ identity: record, secret: record.secret, baseUrl });
  assert.equal((await client.loadModel()).state, "ready");
  const native = await nativeIdentity();
  await sample("loaded", native);

  const short = ["hello"];
  // The fixed model tokenizes this synthetic sequence as 2002 tokens including boundaries.
  const long = [" memory".repeat(2000)];
  await encode(client, "short-before", short);
  const longReference = await encode(client, "long", long);
  const longSamples = [await sample("after-long", native)];
  for (let repeat = 0; repeat < 3; repeat++) {
    const repeated = await encode(client, `long-repeat-${repeat + 1}`, long);
    compareRows(longReference, repeated);
    longSamples.push(await sample(`after-long-repeat-${repeat + 1}`, native));
  }
  for (let repeat = 0; repeat < 3; repeat++) {
    await encode(client, `short-after-${repeat + 1}`, short);
  }
  await sample("after-further-short", native);
  // The same HTTP array can occupy opposite native slots. Capture both live
  // layouts before sleep; REPACK numeric drift from that relayout is pre-existing.
  const mixed = [long[0]!, "工程知识检索与实现验证。"];
  const beforeSleep = await encode(client, "mixed-reference", mixed);
  await encode(client, "prepare-alternate-slots", [long[0]!, long[0]!]);
  await encode(client, "prepare-alternate-short-slot", [mixed[1]!]);
  const alternateLayout = await encode(client, "mixed-alternate-reference", mixed);
  const referenceLayouts = [beforeSleep, alternateLayout];
  const idleStarted = performance.now();
  await sample("before-idle", native);
  const highWater = Math.max(...longSamples.map((entry) => entry.footprintMiB));
  const sleeping = await waitForIdle(native, highWater, idleStarted, "first-idle");
  await assertNativeIdentity(native);
  assert.equal((await client.status()).state, "ready");
  assert.equal((await client.statusModel()).state, "ready");
  assert.equal((await client.loadModel()).state, "ready");
  // Observe beyond the control replies: an accidental asynchronous reload must
  // not hide behind a quick ready response. Relative slack tolerates sampling noise.
  for (let observation = 0; observation < 6; observation++) {
    if (observation > 0) await Bun.sleep(1000);
    const current = await sample("ready-controls-no-wake", native);
    assert(
      current.footprintMiB <= sleeping.footprintMiB * 1.5,
      "Status and repeated load must not restore native physical memory",
    );
    assert(
      current.rssMiB <= sleeping.rssMiB * 1.5,
      "Status and repeated load must not restore native RSS",
    );
    await assertNativeIdentity(native);
  }

  const afterSleep = await encode(client, "wake-mixed", mixed);
  const secondIdleStarted = performance.now();
  const consistency = compareLayouts(referenceLayouts, afterSleep);
  await assertNativeIdentity(native);
  const awake = await sample("after-wake", native);
  await waitForIdle(native, awake.footprintMiB, secondIdleStarted, "second-idle");
  assert.equal((await client.statusModel()).state, "ready");
  assert.equal((await client.unloadModel()).state, "unloaded");
  await waitForProcessExit(native);
  assert.equal(
    (await readRecord(runtimeDirectory))?.modelProcess,
    undefined,
    "Unload must clear sleeping native ownership",
  );

  assert.equal((await client.loadModel()).state, "ready");
  const reloaded = await nativeIdentity();
  assert.notDeepEqual(reloaded, native, "Explicit unload/reload must create a new native identity");
  assert.equal(reloaded.nativeBuild, native.nativeBuild, "Reload must use the same native build");
  const afterReload = await encode(client, "reload-mixed", mixed);
  const reloadConsistency = compareLayouts(referenceLayouts, afterReload);
  await sample("after-reload", reloaded);
  assert.equal((await client.unloadModel()).state, "unloaded");
  await waitForProcessExit(reloaded);
  evidence = {
    nativeBuildIdentity: native.nativeBuild,
    longInputTokens: 2002,
    idleThresholdSeconds: 60,
    observationBudgetSeconds: 90,
    requestBudgetMs: DEFAULT_BACKEND_SETTINGS.requestTimeoutMs,
    firstIdleFootprintReduction: 1 - sleeping.footprintMiB / highWater,
    referenceLayouts: referenceLayouts.length,
    consistency,
    reloadConsistency,
    sameNativeAcrossSleepAndWake: true,
    readyControlsDidNotWake: true,
    sleepingUnloadStoppedNative: true,
    reloadEncoded: true,
  };
  passed = true;
} finally {
  try {
    await supervisor.stop();
  } finally {
    try {
      // Only identities recorded by this private runtime are eligible for cleanup.
      for (const identity of [...ownedNative, ...(daemon ? [daemon] : [])]) {
        if (await isSameProcess(identity)) {
          process.kill(identity.pid, "SIGKILL");
          await waitForProcessExit(identity);
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true });
      // Keep diagnostics useful on a regression too, without PIDs, ports, paths,
      // credentials or raw native logs. No machine-specific latency gate.
      console.log(
        JSON.stringify({
          scenario: "idle-memory",
          platform: "darwin",
          status: passed ? "passed" : "failed",
          ...evidence,
          memory,
          latencies,
        }),
      );
    }
  }
}

async function nativeIdentity(): Promise<NativeIdentity> {
  const record = await readRecord(runtimeDirectory);
  assert(record?.modelProcess, "Loaded model must publish its native identity");
  const identity = record.modelProcess;
  if (
    !ownedNative.some(
      (owned) => owned.pid === identity.pid && owned.startedAt === identity.startedAt,
    )
  ) {
    ownedNative.push(identity);
  }
  return identity;
}

async function assertNativeIdentity(expected: NativeIdentity): Promise<void> {
  assert.deepEqual(
    await nativeIdentity(),
    expected,
    "Idle and wake must retain the native identity",
  );
  assert(await isSameProcess(expected), "The original native process must remain alive");
}

async function sample(phase: string, identity: NativeIdentity): Promise<MemorySample> {
  assert(await isSameProcess(identity), "Footprint sampling requires the owned live native");
  const { stdout } = await execFileAsync(
    "/usr/bin/footprint",
    ["-p", String(identity.pid), "-f", "bytes", "--noCategories"],
    { timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  // phys_footprint is the current physical ledger; do not use its historical peak.
  const match = /^\s*phys_footprint:\s*(\d+)\s+B\s*$/m.exec(stdout);
  assert(match, "footprint must report the current physical footprint in bytes");
  const footprintBytes = Number(match[1]);
  assert(
    Number.isFinite(footprintBytes) && footprintBytes > 0,
    "Physical footprint must be finite and positive",
  );
  const rssMiB = await readRssMiB(identity);
  const observation = {
    phase,
    elapsedMs: performance.now() - started,
    footprintMiB: footprintBytes / (1024 * 1024),
    rssMiB,
  };
  memory.push(observation);
  return observation;
}

async function waitForIdle(
  native: NativeIdentity,
  activeFootprintMiB: number,
  idleStarted: number,
  phase: string,
): Promise<MemorySample> {
  let sleeping: MemorySample | undefined;
  // waitUntil supplies the bounded deadline; the inner pause avoids running the
  // footprint utility every 20 ms during the real production 60-second interval.
  await waitUntil(
    `${phase} physical footprint to fall by at least 50%`,
    async () => {
      const current = await sample(phase, native);
      if (
        performance.now() - idleStarted >= 60_000 &&
        current.footprintMiB <= activeFootprintMiB * 0.5
      ) {
        sleeping = current;
        return true;
      }
      await Bun.sleep(2000);
      return false;
    },
    90_000,
  );
  assert(sleeping, "Idle observation must include a physical-memory reduction");
  return sleeping;
}

async function encode(client: BackendClient, phase: string, inputs: readonly string[]) {
  const began = performance.now();
  const result = await client.embed("document", inputs);
  latencies.push({ phase, durationMs: performance.now() - began });
  assert.equal(
    result.vectors.length,
    inputs.length,
    "Every input must have exactly one output row",
  );
  result.vectors.forEach(assertUnitVector);
  return result.vectors;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (const [index, value] of left.entries()) {
    const other = right[index];
    assert(other !== undefined);
    dot += value * other;
    leftSquared += value * value;
    rightSquared += other * other;
  }
  return dot / Math.sqrt(leftSquared * rightSquared);
}

function compareLayouts(references: number[][][], actual: number[][]) {
  let nearest = references[0]!;
  let nearestScore = -Infinity;
  for (const reference of references) {
    assert.equal(actual.length, reference.length);
    const score = Math.min(...actual.map((row, index) => cosine(row, reference[index]!)));
    if (score > nearestScore) {
      nearest = reference;
      nearestScore = score;
    }
  }
  // Keep the strict same-layout bound and input association checks. Do not
  // relax them to accommodate a different physical token order.
  return compareRows(nearest, actual);
}

function compareRows(expected: number[][], actual: number[][]) {
  assert.equal(actual.length, expected.length);
  let minCosine = 1;
  let maxComponentDelta = 0;
  let minAssociationMargin = 1;
  for (const [index, row] of actual.entries()) {
    const reference = expected[index];
    assertUnitVector(reference);
    assertUnitVector(row);
    const similarity = cosine(row, reference);
    // Match the existing frozen quantized-vector cosine tolerance, not bitwise
    // equality or a comparison against a different native batch shape.
    assert(similarity > 0.999, "Same-shape output must preserve quantized vector identity");
    minCosine = Math.min(minCosine, similarity);
    for (const [component, value] of row.entries()) {
      maxComponentDelta = Math.max(maxComponentDelta, Math.abs(value - reference[component]!));
    }
    for (const [candidate, other] of expected.entries()) {
      if (candidate === index) continue;
      const margin = similarity - cosine(row, other);
      assert(margin > 0, "Output row must belong to its input, not a neighboring sequence");
      minAssociationMargin = Math.min(minAssociationMargin, margin);
    }
  }
  return {
    rows: actual.length,
    dimensions: 384,
    minCosine,
    maxComponentDelta,
    minAssociationMargin,
  };
}
