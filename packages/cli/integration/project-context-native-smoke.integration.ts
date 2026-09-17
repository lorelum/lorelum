/* eslint-disable no-await-in-loop -- Native smoke observations are ordered by lifecycle. */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { createEmbeddingProfile, createLocalStore, createQueryService } from "@lorelum/engine";
import { createBackendClient } from "@lorelum/backend/client";
import { resolveEmbeddingConfig, DEFAULT_BACKEND_SETTINGS } from "@lorelum/backend/config";
import {
  createBackendRuntimeCoordinator,
  createIndexRuntimeClient,
} from "@lorelum/backend/coordination";
import { EMBEDDING_MODEL, PROTOCOL_VERSION } from "@lorelum/backend/protocol";

import { createBackendApp } from "../../backend/src/app.js";
import { downloadFile } from "../../backend/src/download/file.js";
import { prepareModel } from "../../backend/src/models/prepare.js";
import { createBackendService } from "../../backend/src/modules/backend/service.js";
import { createEmbeddingService } from "../../backend/src/modules/embedding/service.js";
import {
  createEmbeddingAdapter,
  createQueryEmbeddingAdapter,
} from "../../backend/src/modules/index/embedding-adapter.js";
import { ContentAddressedSemanticRuntime } from "../../backend/src/modules/query/content-addressed-semantic-runtime.js";
import { SemanticOperationJournal } from "../../backend/src/modules/query/project-operation-journal.js";
import { createEmbeddingProcess } from "../../backend/src/runtime/embedding-process.js";
import { createCacheCommands } from "../src/cache/commands.js";
import { createGetCommand } from "../src/get/get-command.js";
import { createIndexCommands } from "../src/index/index-commands.js";
import { run } from "../src/main.js";
import { createModelCommands } from "../src/model/commands.js";
import { type OutputWriter } from "../src/output/protocol.js";
import { createProjectContextCommands } from "../src/project-context/commands.js";
import { createProjectContextResolver } from "../src/project-context/service.js";
import { createQueryCommand } from "../src/query/query-command.js";
import { createSemanticRuntimeClient } from "../src/query/runtime-client.js";
import { snapshotCommandDefinitions } from "../src/registry.js";
import { createInterruptedDownloadServer } from "../../backend/integration/support/download-server.js";

interface Envelope {
  readonly ok?: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: { readonly code?: string };
}
interface Invocation {
  readonly exitCode: number;
  readonly elapsedMs: number;
  readonly response: Envelope;
}

class MemoryWriter implements OutputWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

const modelPath = process.argv[2];
if (modelPath === undefined) {
  throw new Error(
    "Usage: bun packages/cli/integration/project-context-native-smoke.integration.ts /absolute/path/to/granite-q4_0.gguf",
  );
}

const totalPractices = Math.max(48, EMBEDDING_MODEL.maxInputs * 3);
const root = await realpath(await mkdtemp(join(tmpdir(), "lorelum-project-context-native-smoke-")));
const storeRoot = join(root, "store");
const cacheRoot = join(root, "cache");
const modelCacheRoot = join(root, "model-cache");
const parentRoot = join(root, "parent");
const childRoot = join(parentRoot, "child");
const mirrorRoot = join(root, "mirror");
const identity = {
  instanceId: randomUUID(),
  buildIdentity: "project-context-native-smoke",
  protocolVersion: PROTOCOL_VERSION,
};
const secret = "project-context-native-smoke";

let app: ReturnType<typeof createBackendApp> | undefined;
let embedding: ReturnType<typeof createEmbeddingService> | undefined;
let releaseSecondBatch: (() => void) | undefined;

try {
  await Promise.all([
    mkdir(storeRoot, { recursive: true }),
    mkdir(parentRoot, { recursive: true }),
  ]);
  await writeProjectPack(parentRoot, totalPractices);
  await writeChildOverlay(childRoot);

  const downloadServer = createInterruptedDownloadServer(resolve(modelPath));
  try {
    const config = resolveEmbeddingConfig({ cacheDirectory: modelCacheRoot });
    embedding = createEmbeddingService({
      settings: {
        ...DEFAULT_BACKEND_SETTINGS,
        startupTimeoutMs: 60_000,
        requestTimeoutMs: 60_000,
        shutdownTimeoutMs: 10_000,
      },
      threads: 4,
      prepareModel: (signal, progress) =>
        prepareModel(config, signal, progress, {
          download: (options) =>
            downloadFile({ ...options, url: downloadServer.url }, { protocols: "=http,https" }),
        }),
      createRuntime: (path) => createEmbeddingProcess({ modelPath: path, threads: 4 }),
    });
    const store = createLocalStore();
    const profile = createEmbeddingProfile({
      encodingId: embedding.status().encodingId,
      dimensions: embedding.status().dimensions,
    });
    let successfulDocumentBatches = 0;
    let documentCalls = 0;
    let encodedDocumentCount = 0;
    let documentEncodingMs = 0;
    let secondBatchEntered!: () => void;
    const secondBatch = new Promise<void>((resolveSecond) => {
      secondBatchEntered = resolveSecond;
    });
    let gateUsed = false;
    const documentEmbedding = {
      maxBatchSize: EMBEDDING_MODEL.maxInputs,
      async embed(inputs: readonly string[]) {
        documentCalls += 1;
        if (!gateUsed && successfulDocumentBatches >= 1) {
          gateUsed = true;
          secondBatchEntered();
          await new Promise<void>((resolveGate) => {
            releaseSecondBatch = resolveGate;
          });
        }
        const started = performance.now();
        const result = await createEmbeddingAdapter(embedding!).embed(inputs);
        documentEncodingMs += performance.now() - started;
        encodedDocumentCount += inputs.length;
        successfulDocumentBatches += 1;
        return result;
      },
    };
    const semanticRuntime = new ContentAddressedSemanticRuntime(
      store,
      profile,
      documentEmbedding,
      createQueryEmbeddingAdapter(embedding),
      embedding,
      new SemanticOperationJournal(join(root, "runtime")),
    );
    app = createBackendApp({
      backend: createBackendService({
        identity,
        secret,
        isReady: () => true,
        modelState: () => embedding!.status().state,
        onStop: () => Promise.resolve(),
      }),
      embedding,
      port: 0,
      keywordQueryService: createQueryService({ store }),
      semanticRuntime,
    });
    app.listen({ hostname: "127.0.0.1", port: 0 });
    assert(app.server, "Native smoke Backend must listen on an ephemeral loopback port");
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: `http://127.0.0.1:${app.server.port}`,
      timeoutMs: 70_000,
      startupTimeoutMs: 70_000,
    });
    const coordinator = createBackendRuntimeCoordinator({
      connect: async () => client,
      start: async () => undefined,
    });
    const runtimeClient = createSemanticRuntimeClient(coordinator, new MemoryWriter());
    const resolver = createProjectContextResolver(store);
    const definitions = snapshotCommandDefinitions([
      ...createProjectContextCommands({
        storageRoot: { rootPath: storeRoot },
        resolveProjectContext: resolver,
      }),
      createGetCommand({
        store,
        storageRoot: { rootPath: storeRoot },
        resolveProjectContext: resolver,
      }),
      createQueryCommand({
        queryService: createQueryService({ store }),
        createClient: async () => runtimeClient,
        storageRoot: { rootPath: storeRoot },
        resolveProjectContext: resolver,
      }),
      ...createIndexCommands({
        createClient: async () => client,
        createRuntimeClient: async () => createIndexRuntimeClient(coordinator),
        storageRoot: { rootPath: storeRoot },
        resolveProjectContext: resolver,
      }),
      ...createModelCommands({
        createClient: async () => client,
        progressWriter: new MemoryWriter(),
      }),
      ...createCacheCommands(),
    ]);
    const invoke = (args: readonly string[]) => invokeCommand(definitions, args);
    const parentReadArgs = ["--store-root", storeRoot, "--project-root", parentRoot];
    const parentArgs = [
      "--store-root",
      storeRoot,
      "--cache-root",
      cacheRoot,
      "--project-root",
      parentRoot,
    ];
    const childArgs = [
      "--store-root",
      storeRoot,
      "--cache-root",
      cacheRoot,
      "--project-root",
      childRoot,
    ];

    const childReadArgs = ["--store-root", storeRoot, "--project-root", childRoot];
    const context = await invoke([...childReadArgs, "context", "status"]);
    expectOk("context status", context);
    assert.equal(context.response.data?.state, "degraded");
    const childGet = await invoke([...childReadArgs, "get", "performance.practice.000"]);
    expectOk("child winner get", childGet);
    assert.equal(childGet.response.data?.practice?.title, "Child winner");
    const noProject = await invoke([
      "--store-root",
      storeRoot,
      "--no-project",
      "get",
      "performance.practice.000",
    ]);
    assert.equal(noProject.exitCode, 2);
    assert.equal(noProject.response.error?.code, "practice.not-found");
    const keyword = await invoke([
      ...childArgs,
      "query",
      "child winner marker",
      "--mode",
      "keyword",
    ]);
    expectOk("offline keyword query", keyword);

    const initialStatus = await invoke([...parentArgs, "index", "status"]);
    expectOk("cold index status", initialStatus);
    assert.equal(initialStatus.response.data?.state, "missing");
    const coldQuery = await invoke([
      ...parentArgs,
      "query",
      "marker-v1-010",
      "--max-wait-ms",
      "0",
      "--min-coverage-percent",
      "1",
    ]);
    assert.equal(coldQuery.exitCode, 1);
    assert.notEqual(coldQuery.response.error?.code, "backend.deadline-exceeded");
    assert(["indexing", "preparing"].includes(String(coldQuery.response.data?.state)));
    await waitFor("model download to begin", 20_000, () => embedding!.status().state === "loading");
    await waitFor(
      "first published semantic batch",
      180_000,
      () => releaseSecondBatch !== undefined,
    );
    await secondBatch;

    const partialQuery = await invoke([
      ...parentArgs,
      "query",
      "marker-v1-010",
      "--max-wait-ms",
      "0",
      "--min-coverage-percent",
      "1",
    ]);
    expectOk("partial semantic query", partialQuery);
    assert.equal(partialQuery.response.data?.coverage, "partial");
    const strictQuery = await invoke([
      ...parentArgs,
      "query",
      "marker-v1-010",
      "--max-wait-ms",
      "0",
      "--require-complete",
    ]);
    assert.equal(strictQuery.exitCode, 1);
    assert.equal(strictQuery.response.data?.state, "indexing");
    releaseSecondBatch?.();
    await semanticRuntime.waitForIdle(Date.now() + 180_000);
    const initialDocumentEmbedding = {
      documentCount: encodedDocumentCount,
      elapsedMs: documentEncodingMs,
    };
    const modelFile = join(modelCacheRoot, EMBEDDING_MODEL.sha256, "model.gguf");
    assert.equal((await stat(modelFile)).size, EMBEDDING_MODEL.bytes);

    const completeQuery = await invoke([
      ...parentArgs,
      "query",
      "marker-v1-010",
      "--max-wait-ms",
      "0",
      "--require-complete",
    ]);
    expectOk("complete semantic query", completeQuery);
    assert.equal(completeQuery.response.data?.coverage, "complete");
    const warmSamples = await samples(5, async () => {
      const result = await invoke([
        ...parentArgs,
        "query",
        "marker-v1-010",
        "--max-wait-ms",
        "0",
        "--require-complete",
      ]);
      expectOk("warm semantic query", result);
      return result.elapsedMs;
    });

    await cp(join(parentRoot, ".lorelum"), join(mirrorRoot, ".lorelum"), { recursive: true });
    const beforeMirrorDocuments = documentCalls;
    const mirrorQuery = await invoke([
      "--store-root",
      storeRoot,
      "--cache-root",
      cacheRoot,
      "--project-root",
      mirrorRoot,
      "query",
      "marker-v1-010",
      "--max-wait-ms",
      "0",
      "--require-complete",
    ]);
    expectOk("equivalent directory reuse", mirrorQuery);
    assert.equal(mirrorQuery.response.data?.coverage, "complete");
    assert.equal(
      documentCalls,
      beforeMirrorDocuments,
      "Equivalent corpus must not re-embed documents",
    );

    await writePractice(parentRoot, 10, "marker-v2-010");
    const beforeIncrementalDocuments = documentCalls;
    const beforeIncrementalEmbedding = {
      documentCount: encodedDocumentCount,
      elapsedMs: documentEncodingMs,
    };
    const incrementalBuild = await invoke([...parentArgs, "index", "build"]);
    expectOk("incremental index build", incrementalBuild);
    await semanticRuntime.waitForIdle(Date.now() + 180_000);
    assert.equal(
      documentCalls - beforeIncrementalDocuments,
      1,
      "Only the changed Practice re-embeds",
    );
    const incrementalDocumentEmbedding = {
      documentCount: encodedDocumentCount - beforeIncrementalEmbedding.documentCount,
      elapsedMs: documentEncodingMs - beforeIncrementalEmbedding.elapsedMs,
    };
    const changedQuery = await invoke([
      ...parentArgs,
      "query",
      "marker-v2-010",
      "--max-wait-ms",
      "0",
      "--require-complete",
    ]);
    expectOk("incremental semantic query", changedQuery);
    const rebuild = await invoke([...parentArgs, "index", "rebuild"]);
    expectOk("index rebuild", rebuild);
    await semanticRuntime.waitForIdle(Date.now() + 180_000);

    const cacheBeforePrune = await invoke(["--cache-root", cacheRoot, "cache", "status"]);
    expectOk("cache status", cacheBeforePrune);
    const cachePrune = await invoke(["--cache-root", cacheRoot, "cache", "prune"]);
    expectOk("cache prune", cachePrune);
    const sourceAfterPrune = await invoke([...parentReadArgs, "get", "performance.practice.010"]);
    expectOk("canonical get after cache prune", sourceAfterPrune);

    const unload = await invoke(["model", "unload"]);
    expectOk("model unload", unload);
    assert.equal(unload.response.data?.state, "unloaded");
    const modelLoad = await invoke(["model", "load"]);
    expectOk("model reload", modelLoad);

    console.log(
      JSON.stringify({
        scenario: "project-context-native-smoke",
        status: "passed",
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
          documentBatches: documentCalls,
          initialDocumentEmbedding: summarizeThroughput(initialDocumentEmbedding),
          incrementalDocumentEmbedding: summarizeThroughput(incrementalDocumentEmbedding),
          downloadRequests: downloadServer.offsets.length,
        },
      }),
    );
  } finally {
    await downloadServer.stop();
  }
} finally {
  releaseSecondBatch?.();
  await embedding?.unload().catch(() => {});
  if (app?.server) await app.stop(true);
  await rm(root, { recursive: true, force: true });
}

async function writeProjectPack(rootDirectory: string, count: number): Promise<void> {
  const pack = join(rootDirectory, ".lorelum", "packs", "performance");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: performance\nversion: 1.0.0\n");
  await Promise.all(
    Array.from({ length: count }, (_, index) => writePractice(rootDirectory, index)),
  );
}

async function writeChildOverlay(rootDirectory: string): Promise<void> {
  const pack = join(rootDirectory, ".lorelum", "packs", "performance");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: performance\nversion: 1.0.0\n");
  await writeFile(
    join(pack, "practices", "performance.practice.000.md"),
    practice("performance.practice.000", "Child winner", "child winner marker"),
  );
  await writeFile(join(pack, "practices", "invalid.md"), "---\nid: [\n---\ninvalid\n");
}

function practice(id: string, title: string, marker: string): string {
  return `---
id: ${id}
title: ${title}
stage: implementation
tech_stack:
  - typescript
applies_when: When verifying native ProjectContext semantic retrieval.
---
${Array.from(
  { length: 12 },
  (_, index) =>
    `Practice ${id} documents ${marker} for native semantic retrieval batch ${index + 1}.`,
).join("\n")}
`;
}

async function writePractice(rootDirectory: string, index: number, marker?: string): Promise<void> {
  const suffix = String(index).padStart(3, "0");
  await writeFile(
    join(
      rootDirectory,
      ".lorelum",
      "packs",
      "performance",
      "practices",
      `performance.practice.${suffix}.md`,
    ),
    practice(
      `performance.practice.${suffix}`,
      `Performance Practice ${suffix}`,
      marker ?? `marker-v1-${suffix}`,
    ),
  );
}

async function invokeCommand(
  definitions: Parameters<typeof run>[1] extends { registry?: infer T } ? NonNullable<T> : never,
  args: readonly string[],
): Promise<Invocation> {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const started = performance.now();
  const exitCode = await run(["--json", ...args], { registry: definitions, stdout, stderr });
  const elapsedMs = Number((performance.now() - started).toFixed(1));
  const response = JSON.parse(stdout.value) as Envelope;
  return { exitCode, elapsedMs, response };
}

function expectOk(name: string, result: Invocation): void {
  assert.equal(result.exitCode, 0, `${name} exit: ${JSON.stringify(result.response)}`);
  assert.equal(result.response.ok, true, `${name} response: ${JSON.stringify(result.response)}`);
}

async function waitFor(name: string, timeoutMs: number, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out waiting for ${name} after ${timeoutMs}ms`);
}

async function samples(count: number, sample: () => Promise<number>): Promise<readonly number[]> {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) values.push(await sample());
  return values;
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

function summarizeThroughput(value: {
  readonly documentCount: number;
  readonly elapsedMs: number;
}) {
  return {
    documentCount: value.documentCount,
    elapsedMs: Number(value.elapsedMs.toFixed(1)),
    documentsPerSecond:
      value.elapsedMs === 0
        ? 0
        : Number(((value.documentCount * 1000) / value.elapsedMs).toFixed(2)),
  };
}
