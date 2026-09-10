import { consumeDaemonLaunch, resolveBackendSettings } from "../config";
import { createLocalStore, createQueryService } from "@lorelum/engine";
import { BACKEND_HOST, MAX_BODY_BYTES } from "../protocol/constants";
import { BackendError } from "../protocol/errors";
import { createBackendApp } from "../app";
import { createBackendService } from "../modules/backend/service";
import { isSameProcess } from "./process-identity";
import { readRecord, removeRecord } from "./runtime-state";
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
  let ready = false;
  const backend = createBackendService({
    identity: {
      instanceId: record.instanceId,
      buildIdentity: record.buildIdentity,
      controlVersion: record.controlVersion,
      businessVersion: record.businessVersion,
    },
    secret: record.secret,
    isReady: () => ready,
    onStop: shutdown,
    onStopFailure: () => {
      process.exitCode = 1;
    },
  });
  const app = createBackendApp({
    backend,
    port,
    queryService: createQueryService({ store: createLocalStore() }),
  });
  const signalHandler = () => {
    void backend.stop();
  };
  async function shutdown(): Promise<void> {
    const force = setTimeout(() => {
      void app.stop(true);
    }, settings.shutdownTimeoutMs);
    try {
      await app.stop(false);
      await logEvent(directory, "stopped");
      await removeRecord(directory, instanceId);
    } finally {
      clearTimeout(force);
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
