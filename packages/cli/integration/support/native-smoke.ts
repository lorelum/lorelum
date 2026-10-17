import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createLocalStore, createQueryService } from "@lorelum/engine";
import { createBackendClient } from "@lorelum/backend/client";
import { DEFAULT_BACKEND_SETTINGS, resolveEmbeddingConfig } from "@lorelum/backend/config";
import {
  createBackendRuntimeCoordinator,
  createIndexRuntimeClient,
} from "@lorelum/backend/coordination";
import { EMBEDDING_MODEL, PROTOCOL_VERSION } from "@lorelum/backend/protocol";

import { createInterruptedDownloadServer } from "../../../backend/integration/support/download-server.js";
import { waitUntil } from "../../../backend/integration/support/process.js";
import { createBackendApp } from "../../../backend/src/app.js";
import { downloadFile } from "../../../backend/src/download/file.js";
import { prepareModel } from "../../../backend/src/models/prepare.js";
import { createBackendService } from "../../../backend/src/modules/backend/service.js";
import {
  createEmbeddingService,
  type EmbeddingService,
} from "../../../backend/src/modules/embedding/service.js";
import type { ModelState } from "../../../backend/src/modules/embedding/model.js";
import {
  createEmbeddingAdapter,
  createQueryEmbeddingAdapter,
} from "../../../backend/src/modules/index/embedding-adapter.js";
import { ContentAddressedSemanticRuntime } from "../../../backend/src/modules/query/content-addressed-semantic-runtime.js";
import { SemanticOperationJournal } from "../../../backend/src/modules/query/project-operation-journal.js";
import { createEmbeddingProcess } from "../../../backend/src/runtime/embedding-process.js";
import { createCacheCommands } from "../../src/cache/commands.js";
import { createGetCommand } from "../../src/get/get-command.js";
import { createIndexCommands } from "../../src/index/index-commands.js";
import { run } from "../../src/main.js";
import { createModelCommands } from "../../src/model/commands.js";
import type { OutputWriter } from "../../src/output/protocol.js";
import { createProjectContextCommands } from "../../src/project-context/commands.js";
import { createProjectContextResolver } from "../../src/project-context/service.js";
import { createQueryCommand } from "../../src/query/query-command.js";
import { createSemanticRuntimeClient } from "../../src/query/runtime-client.js";
import { loadSemanticRetrievalSettings } from "../../src/query/settings.js";
import { snapshotCommandDefinitions, type CommandDefinition } from "../../src/registry.js";
import { isRecord, parseSingleResponse } from "./protocol.js";

class MemoryWriter implements OutputWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

export interface NativeCommandResult {
  readonly exitCode: number;
  readonly elapsedMs: number;
  readonly response: {
    readonly ok: unknown;
    readonly data: Record<string, unknown> | undefined;
    readonly error: Record<string, unknown> | undefined;
  };
}

export interface NativeEncodingStats {
  readonly batches: number;
  readonly documentCount: number;
  readonly elapsedMs: number;
}

export interface NativeSmokeSession {
  readonly root: string;
  readonly cacheRoot: string;
  readonly configFile: string;
  invoke(args: readonly string[]): Promise<NativeCommandResult>;
}

export interface NativeSmokeEnvironment {
  readonly modelFile: string;
  modelState(): ModelState;
  downloadRequests(): number;
  encodingStats(): NativeEncodingStats;
  waitForIdle(): Promise<void>;
  pauseAfterFirstBatch(): { wait(): Promise<void>; release(): void };
  createSession(name: string): Promise<NativeSmokeSession>;
  dispose(): Promise<void>;
}

/** One real model/runtime and HTTP Backend; sessions own separate Store/cache/config paths. */
export async function createNativeSmokeEnvironment(
  modelPath: string,
): Promise<NativeSmokeEnvironment> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "lorelum-project-context-native-smoke-")),
  );
  const modelCacheRoot = join(root, "model-cache");
  let stopApp: (() => Promise<void>) | undefined;
  let embedding: EmbeddingService | undefined;
  let stopDownload: (() => Promise<void> | void) | undefined;
  let beforeDocumentBatch: (() => Promise<void>) | undefined;
  let releaseBatch: (() => void) | undefined;
  let documentBatches = 0;
  let completedDocumentBatches = 0;
  let documentCount = 0;
  let documentEncodingMs = 0;

  async function dispose(): Promise<void> {
    releaseBatch?.();
    try {
      await embedding?.unload();
    } finally {
      try {
        await stopApp?.();
      } finally {
        try {
          await stopDownload?.();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }

  try {
    const source = createInterruptedDownloadServer(resolve(modelPath));
    stopDownload = source.stop;
    const config = resolveEmbeddingConfig({ cacheDirectory: modelCacheRoot });
    const service = createEmbeddingService({
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
            downloadFile({ ...options, url: source.url }, { protocols: "=http,https" }),
        }),
      createRuntime: (path) => createEmbeddingProcess({ modelPath: path, threads: 4 }),
    });
    embedding = service;
    const store = createLocalStore();
    const documentAdapter = createEmbeddingAdapter(service);
    const runtime = new ContentAddressedSemanticRuntime(
      store,
      { encodingId: service.status().encodingId, dimensions: service.status().dimensions },
      {
        maxBatchSize: EMBEDDING_MODEL.maxInputs,
        async embed(inputs: readonly string[]) {
          documentBatches += 1;
          await beforeDocumentBatch?.();
          const started = performance.now();
          const result = await documentAdapter.embed(inputs);
          documentEncodingMs += performance.now() - started;
          documentCount += inputs.length;
          completedDocumentBatches += 1;
          return result;
        },
      },
      createQueryEmbeddingAdapter(service),
      service,
      new SemanticOperationJournal(join(root, "runtime")),
    );
    const identity = {
      instanceId: randomUUID(),
      buildIdentity: "project-context-native-smoke",
      protocolVersion: PROTOCOL_VERSION,
    };
    const secret = "project-context-native-smoke";
    const app = createBackendApp({
      backend: createBackendService({
        identity,
        secret,
        isReady: () => true,
        modelState: () => service.status().state,
        onStop: () => Promise.resolve(),
      }),
      embedding: service,
      port: 0,
      keywordQueryService: createQueryService({ store }),
      semanticRuntime: runtime,
    });
    stopApp = async () => {
      if (app.server) await app.stop(true);
    };
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
    const resolver = createProjectContextResolver(store);
    const encodingStats = () => ({
      batches: documentBatches,
      documentCount,
      elapsedMs: documentEncodingMs,
    });

    return {
      modelFile: join(modelCacheRoot, EMBEDDING_MODEL.sha256, "model.gguf"),
      modelState: () => service.status().state,
      downloadRequests: () => source.offsets.length,
      encodingStats,
      waitForIdle: () => runtime.waitForIdle(Date.now() + 180_000),
      pauseAfterFirstBatch() {
        const afterCompletedBatch = completedDocumentBatches + 1;
        let paused = false;
        const released = new Promise<void>((resume) => {
          releaseBatch = resume;
        });
        beforeDocumentBatch = async () => {
          if (completedDocumentBatches < afterCompletedBatch) return;
          beforeDocumentBatch = undefined;
          paused = true;
          await released;
        };
        return {
          wait: () => waitUntil("first published semantic batch", async () => paused, 180_000),
          release: () => releaseBatch?.(),
        };
      },
      async createSession(name: string) {
        const sessionRoot = join(root, name);
        const storeRoot = join(sessionRoot, "store");
        const cacheRoot = join(sessionRoot, "cache");
        const configHome = join(sessionRoot, "home");
        await mkdir(storeRoot, { recursive: true });
        await mkdir(join(configHome, ".lorelum"), { recursive: true });
        const storageRoot = { rootPath: storeRoot };
        const loadSemanticSettings = () =>
          loadSemanticRetrievalSettings({ homeDirectory: configHome });
        const definitions = snapshotCommandDefinitions([
          ...createProjectContextCommands({ storageRoot, resolveProjectContext: resolver }),
          createGetCommand({ store, storageRoot, resolveProjectContext: resolver }),
          createQueryCommand({
            queryService: createQueryService({ store }),
            createClient: async () => createSemanticRuntimeClient(coordinator, new MemoryWriter()),
            storageRoot,
            resolveProjectContext: resolver,
            loadSemanticSettings,
          }),
          ...createIndexCommands({
            createClient: async () => client,
            createRuntimeClient: async () => createIndexRuntimeClient(coordinator),
            storageRoot,
            loadSemanticSettings,
          }),
          ...createModelCommands({
            createClient: async () => client,
            progressWriter: new MemoryWriter(),
          }),
          ...createCacheCommands(),
        ]);
        return {
          root: sessionRoot,
          cacheRoot,
          configFile: join(configHome, ".lorelum", "config.yaml"),
          invoke: (args: readonly string[]) =>
            invokeCommand(definitions, ["--store-root", storeRoot, ...args]),
        };
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

async function invokeCommand(
  definitions: readonly CommandDefinition[],
  args: readonly string[],
): Promise<NativeCommandResult> {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const started = performance.now();
  const exitCode = await run(["--json", ...args], { registry: definitions, stdout, stderr });
  const elapsedMs = Number((performance.now() - started).toFixed(1));
  const response = parseSingleResponse(stdout.value);
  const { data, error } = response;
  assert(data === undefined || isRecord(data), "Native command data must be an object");
  assert(error === undefined || isRecord(error), "Native command error must be an object");
  return { exitCode, elapsedMs, response: { ...response, ok: response.ok, data, error } };
}

export function expectOk(name: string, result: NativeCommandResult): Record<string, unknown> {
  assert.equal(result.exitCode, 0, `${name} exit: ${JSON.stringify(result.response)}`);
  assert.equal(result.response.ok, true, `${name} response: ${JSON.stringify(result.response)}`);
  assert(isRecord(result.response.data), `${name} must return command data`);
  return result.response.data;
}
