import { prepareEmbeddingResources } from "./embedding-resources";
import { createEmbeddingService } from "../modules/embedding/service";
import { createEmbeddingProcess } from "./embedding-process";
import { consumeDaemonLaunch, resolveBackendSettings, resolveEmbeddingConfig } from "../config";
import { createLocalStore, createQueryService } from "@lorelum/engine";
import { defaultLogDirectory, resolveLoggingSettings } from "@lorelum/config";
import { SinkLogEmitter, TraceDetailLogEmitter } from "@lorelum/log";
import { join } from "node:path";
import { BACKEND_HOST, MAX_BODY_BYTES } from "../protocol/constants";
import { BackendError } from "../protocol/errors";
import { createBackendApp } from "../app";
import { createPracticeHintService } from "../modules/practice-hints/service";
import { createSessionService } from "../modules/sessions/service";
import { createBackendService } from "../modules/backend/service";
import {
  createEmbeddingAdapter,
  createQueryEmbeddingAdapter,
} from "../modules/index/embedding-adapter";
import { ContentAddressedSemanticRuntime } from "../modules/query/content-addressed-semantic-runtime";
import { SemanticOperationJournal } from "../modules/query/project-operation-journal";
import { isSameProcess } from "./process-identity";
import {
  assessRuntimeActivityV4,
  readActivityRecord,
  removeActivityRecord,
  setRuntimeActivity,
  withActivityLock,
} from "./activity-state";
import { readRecord, removeRecord, writeRecord } from "./runtime-state";
import { createPrivateJsonlSink, type PrivateJsonlSink } from "./private-jsonl-sink";
import type { BuildInfo } from "../protocol/build-provenance";

export async function runBackendDaemon(options: { readonly build: BuildInfo }): Promise<void> {
  const { runtimeDirectory: directory, instanceId, port, logDirectory } = consumeDaemonLaunch();
  // Bounded stdin launch grant ensures a dead starter cannot leave an unpublished daemon.
  const grant = await readGrant();
  const record = await readRecord(directory);
  if (
    !record ||
    grant !== instanceId ||
    record.instanceId !== instanceId ||
    record.pid !== process.pid ||
    record.buildIdentity !== options.build.buildIdentity ||
    !(await isSameProcess(record))
  )
    throw new BackendError("backend.unauthorized");
  const settings = resolveBackendSettings(record.settings);
  // This is a startup security boundary. An unsafe target remains a backend
  // state failure; only I/O after a successful preflight degrades to a
  // disabled diagnostic sink.
  const logging = await resolveLoggingSettings();
  const diagnosticSink = await createPrivateJsonlSink({
    directory: join(logDirectory ?? defaultLogDirectory(), "backend"),
    fileName: "current.jsonl",
  });
  const diagnostics = new TraceDetailLogEmitter(
    logging.effectiveLevel,
    new SinkLogEmitter(diagnosticSink),
  );
  if (logging.kind === "fallback") {
    diagnostics.emit({
      time: new Date().toISOString(),
      level: "warn",
      component: "backend",
      event: "logging.level-fallback",
      context: {
        instanceId,
        cause: logging.cause.kind,
        ...(logging.cause.kind === "config" && logging.cause.error.failure !== undefined
          ? { failure: logging.cause.error.failure }
          : {}),
        fallbackLevel: logging.fallbackLevel,
        effectiveLevel: logging.effectiveLevel,
      },
    });
  }
  const updateActivity = async (
    kind: "daemon-startup" | "model-preparation" | "index-operation",
    active: boolean,
  ): Promise<void> => {
    await withActivityLock(directory, settings.requestTimeoutMs, () =>
      setRuntimeActivity(directory, instanceId, kind, active),
    );
  };
  const embeddingConfig = resolveEmbeddingConfig(record.embedding);
  const embedding = createEmbeddingService({
    settings,
    diagnostics,
    onPreparationActivityChange: (active) => updateActivity("model-preparation", active),
    threads: embeddingConfig.threads,
    prepareModel: (signal, progress, preparationDiagnostics) =>
      prepareEmbeddingResources(embeddingConfig, signal, progress, {
        diagnostics: preparationDiagnostics,
      }),
    createRuntime: (prepared, preparationId) =>
      createEmbeddingProcess(
        { ...prepared!, threads: embeddingConfig.threads },
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
        { diagnostics, ...(preparationId === undefined ? {} : { preparationId }) },
      ),
  });
  let ready = false;
  const backend = createBackendService({
    build: options.build,
    identity: {
      instanceId: record.instanceId,
      buildIdentity: record.buildIdentity,
      protocolVersion: record.protocolVersion,
    },
    secret: record.secret,
    isReady: () => ready,
    modelState: () => embedding.status().state,
    onTryBeginIdleStop: () =>
      withActivityLock(directory, settings.requestTimeoutMs, async () => {
        const activity = await readActivityRecord(directory).catch(() => undefined);
        const assessment = assessRuntimeActivityV4(activity, instanceId);
        if (assessment.state === "idle")
          await setRuntimeActivity(directory, instanceId, "handoff-stop", true);
        return assessment;
      }),
    onStop: shutdown,
    onStopFailure: () => {
      process.exitCode = 1;
    },
  });
  const store = createLocalStore();
  const model = embedding.status();
  const semanticRuntime = new ContentAddressedSemanticRuntime(
    store,
    { encodingId: model.encodingId, dimensions: model.dimensions },
    createEmbeddingAdapter(embedding),
    createQueryEmbeddingAdapter(embedding),
    embedding,
    new SemanticOperationJournal(directory),
    (active) => updateActivity("index-operation", active),
    diagnostics,
  );
  const sessions = createSessionService();
  const app = createBackendApp({
    backend,
    embedding,
    port,
    keywordQueryService: createQueryService({ store }),
    semanticRuntime,
    practiceHints: createPracticeHintService({ sessions }),
    diagnostics,
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
        await semanticRuntime.waitForIdle(deadline);
      } catch (error) {
        // Stop the native runtime, then wait for Engine to clean staging and release its writer lock.
        await embedding.unload(Date.now() + settings.shutdownTimeoutMs).catch(() => {});
        await semanticRuntime.waitForIdle();
        throw error;
      }
      await embedding.unload(deadline);
      await app.stop(false);
      await removeRecord(directory, instanceId);
      await withActivityLock(directory, settings.requestTimeoutMs, () =>
        removeActivityRecord(directory, instanceId),
      );
      diagnostics.emit({
        time: new Date().toISOString(),
        level: "info",
        component: "backend",
        event: "backend.daemon.stopped",
      });
      await flushDiagnostics(diagnosticSink, deadline);
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
    await updateActivity("daemon-startup", false);
    ready = true;
    diagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "backend",
      event: "backend.daemon.ready",
    });
  } catch (error) {
    await embedding.unload().catch(() => {});
    if (app.server) await app.stop(true);
    await withActivityLock(directory, settings.requestTimeoutMs, () =>
      removeActivityRecord(directory, instanceId),
    ).catch(() => undefined);
    diagnostics.emit({
      time: new Date().toISOString(),
      level: "error",
      component: "backend",
      event: "backend.daemon.failed",
      code: "backend.failed",
    });
    await flushDiagnostics(diagnosticSink, Date.now() + settings.shutdownTimeoutMs);
    throw new BackendError("backend.failed", { cause: error });
  }
}

/** A log flush is valuable, but never allowed to consume the shutdown deadline. */
async function flushDiagnostics(sink: PrivateJsonlSink, deadline: number): Promise<void> {
  const remaining = Math.max(1, deadline - Date.now());
  await Promise.race([sink.close(), Bun.sleep(remaining)]).catch(() => undefined);
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
