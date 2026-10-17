/* eslint-disable no-await-in-loop -- Warm-query observations use the single native model sequentially. */
import assert from "node:assert/strict";
import { cp, stat } from "node:fs/promises";
import { join } from "node:path";
import { EMBEDDING_MODEL } from "@lorelum/backend/protocol";
import { waitUntil } from "../../../backend/integration/support/process.js";
import {
  writeNativeChildOverlay,
  writeNativePractice,
  writeNativeProjectPack,
} from "../fixtures/native-project.js";
import {
  expectOk,
  type NativeSmokeEnvironment,
  type NativeEncodingStats,
} from "../support/native-smoke.js";
import { isRecord } from "../support/protocol.js";

/** Project inheritance and index lifecycle, independent of experimental method selection. */
export async function verifyProjectContextNativeScenario(environment: NativeSmokeEnvironment) {
  const session = await environment.createSession("project-context");
  const { invoke, cacheRoot } = session;
  const parent = join(session.root, "parent");
  const child = join(parent, "child");
  const mirror = join(session.root, "mirror");
  const totalPractices = Math.max(48, EMBEDDING_MODEL.maxInputs * 3);
  await writeNativeProjectPack(parent, totalPractices);
  await writeNativeChildOverlay(child);
  const parentReadArgs = ["--project-root", parent];
  const parentArgs = ["--cache-root", cacheRoot, ...parentReadArgs];
  const initialQueryArgs = [...parentArgs, "query", "marker-v1-010", "--max-wait-ms", "0"];
  const childReadArgs = ["--project-root", child];
  const childArgs = ["--cache-root", cacheRoot, ...childReadArgs];

  const context = expectOk("context status", await invoke([...childReadArgs, "context", "status"]));
  assert.equal(context.state, "degraded");
  const childGet = expectOk(
    "child winner get",
    await invoke([...childReadArgs, "get", "performance.practice.000"]),
  );
  assert(isRecord(childGet.practice));
  assert.equal(childGet.practice.title, "Child winner");
  const noProject = await invoke(["--no-project", "get", "performance.practice.000"]);
  assert.equal(noProject.exitCode, 2);
  assert.equal(noProject.response.error?.code, "practice.not-found");
  expectOk(
    "offline keyword query",
    await invoke([...childArgs, "query", "child winner marker", "--mode", "keyword"]),
  );

  const initialStatus = expectOk(
    "cold index status",
    await invoke([...parentArgs, "index", "status"]),
  );
  assert.equal(initialStatus.state, "missing");
  const pause = environment.pauseAfterFirstBatch();
  const coldQuery = await invoke([...initialQueryArgs, "--min-coverage-percent", "1"]);
  assert.equal(coldQuery.exitCode, 1);
  assert.notEqual(coldQuery.response.error?.code, "backend.deadline-exceeded");
  assert(["indexing", "preparing"].includes(String(coldQuery.response.data?.state)));
  await waitUntil(
    "model download to begin",
    async () => environment.modelState() === "loading",
    20_000,
  );
  await pause.wait();
  const partialQuery = await invoke([...initialQueryArgs, "--min-coverage-percent", "1"]);
  assert.equal(expectOk("partial semantic query", partialQuery).coverage, "partial");
  const strictQuery = await invoke([...initialQueryArgs, "--require-complete"]);
  assert.equal(strictQuery.exitCode, 1);
  assert.equal(strictQuery.response.data?.state, "indexing");
  pause.release();
  await environment.waitForIdle();
  const initialDocumentEmbedding = environment.encodingStats();
  assert.equal((await stat(environment.modelFile)).size, EMBEDDING_MODEL.bytes);

  const completeQuery = await invoke([...initialQueryArgs, "--require-complete"]);
  assert.equal(expectOk("complete semantic query", completeQuery).coverage, "complete");
  const warmSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await invoke([...initialQueryArgs, "--require-complete"]);
    expectOk("warm semantic query", result);
    warmSamples.push(result.elapsedMs);
  }

  await cp(join(parent, ".lorelum"), join(mirror, ".lorelum"), { recursive: true });
  const beforeMirror = environment.encodingStats();
  const mirrorQuery = await invoke([
    "--cache-root",
    cacheRoot,
    "--project-root",
    mirror,
    "query",
    "marker-v1-010",
    "--max-wait-ms",
    "0",
    "--require-complete",
  ]);
  assert.equal(expectOk("equivalent directory reuse", mirrorQuery).coverage, "complete");
  assert.equal(
    environment.encodingStats().batches,
    beforeMirror.batches,
    "Equivalent corpus must not re-embed documents",
  );

  await writeNativePractice(parent, 10, "marker-v2-010");
  const beforeIncremental = environment.encodingStats();
  const incrementalBuild = await invoke([...parentArgs, "index", "build"]);
  expectOk("incremental index build", incrementalBuild);
  await environment.waitForIdle();
  const afterIncremental = environment.encodingStats();
  assert.equal(
    afterIncremental.batches - beforeIncremental.batches,
    1,
    "Only the changed Practice re-embeds",
  );
  assert.equal(afterIncremental.documentCount - beforeIncremental.documentCount, 1);
  expectOk(
    "incremental semantic query",
    await invoke([
      ...parentArgs,
      "query",
      "marker-v2-010",
      "--max-wait-ms",
      "0",
      "--require-complete",
    ]),
  );
  const rebuild = await invoke([...parentArgs, "index", "rebuild"]);
  expectOk("index rebuild", rebuild);
  await environment.waitForIdle();

  expectOk("cache status", await invoke(["--cache-root", cacheRoot, "cache", "status"]));
  expectOk("cache prune", await invoke(["--cache-root", cacheRoot, "cache", "prune"]));
  expectOk(
    "canonical get after cache prune",
    await invoke([...parentReadArgs, "get", "performance.practice.010"]),
  );
  assert.equal(expectOk("model unload", await invoke(["model", "unload"])).state, "unloaded");
  expectOk("model reload", await invoke(["model", "load"]));

  return {
    fixture: {
      kind: "ordinary-directory",
      totalPractices,
      invalidPractice: true,
      emptyModelCacheBeforeQuery: true,
    },
    observations: {
      coldSubmitMs: coldQuery.elapsedMs,
      partialQueryMs: partialQuery.elapsedMs,
      completeQueryMs: completeQuery.elapsedMs,
      warmSemanticMs: summarize(warmSamples),
      equivalentDirectoryQueryMs: mirrorQuery.elapsedMs,
      incrementalBuildSubmitMs: incrementalBuild.elapsedMs,
      rebuildSubmitMs: rebuild.elapsedMs,
      projectContextDocumentBatches: environment.encodingStats().batches,
      initialDocumentEmbedding: summarizeThroughput(initialDocumentEmbedding),
      incrementalDocumentEmbedding: summarizeThroughput({
        documentCount: afterIncremental.documentCount - beforeIncremental.documentCount,
        elapsedMs: afterIncremental.elapsedMs - beforeIncremental.elapsedMs,
      }),
    },
  };
}

function summarize(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return {
    samples: values,
    mean: Number(mean.toFixed(1)),
    p50: Number(percentile(0.5).toFixed(1)),
    p95: Number(percentile(0.95).toFixed(1)),
  };
}

function summarizeThroughput(value: Pick<NativeEncodingStats, "documentCount" | "elapsedMs">) {
  return {
    documentCount: value.documentCount,
    elapsedMs: Number(value.elapsedMs.toFixed(1)),
    documentsPerSecond:
      value.elapsedMs === 0
        ? 0
        : Number(((value.documentCount * 1000) / value.elapsedMs).toFixed(2)),
  };
}
