import { prepareModel } from "../models/prepare";
import { createEmbeddingService } from "../modules/embedding/service";
import { createEmbeddingProcess } from "./embedding-process";
import { consumeDaemonLaunch, resolveBackendSettings, resolveEmbeddingConfig } from "../config";
import {
  createEmbeddingProfile,
  createLocalStore,
  createQueryService,
  createSemanticIndexService,
} from "@lorelum/engine";
import { BACKEND_HOST, MAX_BODY_BYTES } from "../protocol/constants";
import { BackendError } from "../protocol/errors";
import { createBackendApp } from "../app";
import { createBackendService } from "../modules/backend/service";
import { createEmbeddingAdapter } from "../modules/index/embedding-adapter";
import { createIndexOperationService } from "../modules/index/operation-service";
import { isSameProcess } from "./process-identity";
import { readRecord, removeRecord, writeRecord } from "./runtime-state";
import { logEvent } from "./log";

export async function runBackendDaemon(options: { readonly buildIdentity: string }): Promise<void> {
  const { runtimeDirectory: directory, instanceId, port } = consumeDaemonLaunch();
  // Bounded stdin launch grant ensures a dead starter cannot leave an unpublished daemon.
  const grant = await readGrant();
  const record = await readRecord(directory);
  if (
    !record ||
    grant !== instanceId ||
    record.instanceId !== instanceId ||
    record.pid !== process.pid ||
    record.buildIdentity !== options.buildIdentity ||
    !(await isSameProcess(record))
  )
    throw new BackendError("backend.unauthorized");
  const settings = resolveBackendSettings(record.settings);
  const embeddingConfig = resolveEmbeddingConfig(record.embedding);
  const embedding = createEmbeddingService({
    settings,
    threads: embeddingConfig.threads,
    prepareModel: (signal, progress) => prepareModel(embeddingConfig, signal, progress),
    createRuntime: (modelPath) =>
      createEmbeddingProcess(
        { modelPath, threads: embeddingConfig.threads },
        async (modelProcess) => {
          const current = await readRecord(directory);
          if (!current || current.instanceId !== instanceId)
            throw new BackendError("backend.state-invalid");
          const withoutModel = { ...current };
          delete withoutModel.modelProcess;
          await writeRecord(
            directory,
            modelProcess ? { ...withoutModel, modelProcess } : withoutModel,
          );
        },
      ),
  });
  let ready = false;
  const backend = createBackendService({
    identity: {
      instanceId: record.instanceId,
      buildIdentity: record.buildIdentity,
      protocolVersion: record.protocolVersion,
    },
    secret: record.secret,
    isReady: () => ready,
    modelState: () => embedding.status().state,
    onStop: shutdown,
    onStopFailure: () => {
      process.exitCode = 1;
    },
  });
  const store = createLocalStore();
  const model = embedding.status();
  const semanticIndex = createSemanticIndexService({
    store,
    profile: createEmbeddingProfile({
      encodingId: model.encodingId,
      dimensions: model.dimensions,
    }),
    embedding: createEmbeddingAdapter(embedding),
  });
  const indexOperations = createIndexOperationService(semanticIndex);
  const app = createBackendApp({
    backend,
    embedding,
    port,
    queryService: createQueryService({ store }),
    indexOperations,
  });
  const signalHandler = () => {
    void backend.stop();
  };
  async function shutdown(): Promise<void> {
    const deadline = Date.now() + settings.shutdownTimeoutMs;
    const force = setTimeout(() => {
      void app.stop(true);
    }, settings.shutdownTimeoutMs);
    try {
      try {
        await indexOperations.waitForIdle(deadline);
      } catch (error) {
        // Stop the native runtime, then wait for Engine to clean staging and release its writer lock.
        await embedding.unload(Date.now() + settings.shutdownTimeoutMs).catch(() => {});
        await indexOperations.waitForIdle();
        throw error;
      }
      await embedding.unload(deadline);
      await app.stop(false);
      await logEvent(directory, "stopped");
      await removeRecord(directory, instanceId);
    } finally {
      clearTimeout(force);
      if (app.server) await app.stop(true);
      process.off("SIGTERM", signalHandler);
      process.off("SIGINT", signalHandler);
    }
  }
  try {
    app.listen({
      hostname: BACKEND_HOST,
      port,
      maxRequestBodySize: MAX_BODY_BYTES,
      idleTimeout: 10,
    });
    process.on("SIGTERM", signalHandler);
    process.on("SIGINT", signalHandler);
    await logEvent(directory, "ready");
    ready = true;
  } catch (error) {
    await embedding.unload().catch(() => {});
    if (app.server) await app.stop(true);
    await logEvent(directory, "failed", "backend.failed");
    throw new BackendError("backend.failed", { cause: error });
  }
}
async function readGrant(): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    const timer = setTimeout(() => finish(new BackendError("backend.deadline-exceeded")), 5_000);
    const data = (chunk: Buffer) => {
      value += chunk.toString();
      if (value.length > 128) finish(new BackendError("backend.unauthorized"));
    };
    const end = () => finish();
    const failure = () => finish(new BackendError("backend.unauthorized"));
    function finish(error?: Error) {
      clearTimeout(timer);
      process.stdin.off("data", data);
      process.stdin.off("end", end);
      process.stdin.off("error", failure);
      process.stdin.pause();
      if (error) reject(error);
      else resolve(value);
    }
    process.stdin.on("data", data);
    process.stdin.once("end", end);
    process.stdin.once("error", failure);
  });
}
