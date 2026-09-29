import { waitForSettlement } from "../lifecycle/deadline";
import { createTimeoutSignal } from "../lifecycle/timeout";
import { llamaArguments } from "./llama-options";
/* eslint-disable no-await-in-loop -- Child startup and shutdown polling are sequential and bounded. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { noopEmitter, type LogEmitter, type LogEventInput } from "@lorelum/log";
import { platformEnvironment } from "../config/launch";
import type { EmbeddingConfig } from "../config/embedding";
import { EmbeddingError } from "../modules/embedding/errors";
import type { EmbeddingRuntime } from "../modules/embedding/model";
import { processIdentity, type ProcessIdentity } from "./process-identity";
import { createLlamaClient } from "./llama-client";
import { resolveEmbeddingResources, type EmbeddingResources } from "./embedding-resources";

const MAX_BIND_ATTEMPTS = 3;
const STARTUP_PROBE_TIMEOUT_MS = 500;
const STARTUP_POLL_MS = 25;
const FORCE_KILL_WAIT_MS = 100;

/** Collaboration seams for tests; production callers use the defaults. */
export interface EmbeddingProcessDeps {
  resolveResources?(modelPath: string, signal: AbortSignal): Promise<EmbeddingResources>;
  createClient?: typeof createLlamaClient;
  spawnProcess?(
    executable: string,
    args: readonly string[],
    options: Parameters<typeof spawn>[2],
  ): ReturnType<typeof spawn>;
}

export interface EmbeddingProcessDiagnosticOptions {
  readonly diagnostics?: LogEmitter;
  /** A preparation is a shared resource identity, not a trace owner. */
  readonly preparationId?: string;
}

export function nativeExitLogRecord(input: {
  readonly nativeRunId: string;
  readonly preparationId?: string;
  readonly buildIdentity?: string;
  readonly readiness: "pending" | "ready" | "failed";
  readonly stopped: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}): LogEventInput {
  return {
    time: new Date().toISOString(),
    level: input.stopped ? "info" : input.readiness === "ready" ? "warn" : "error",
    component: "backend",
    event: input.stopped
      ? "native.stopped"
      : input.readiness === "ready"
        ? "native.exited-after-ready"
        : "native.exited-before-ready",
    nativeRunId: input.nativeRunId,
    ...(input.preparationId === undefined ? {} : { preparationId: input.preparationId }),
    ...(input.buildIdentity === undefined ? {} : { buildIdentity: input.buildIdentity }),
    readiness: input.stopped ? input.readiness : input.readiness === "ready" ? "ready" : "failed",
    ...(input.exitCode === null ? {} : { exitCode: input.exitCode }),
    ...(input.signal === null ? {} : { signal: input.signal }),
    stdoutBytes: input.stdoutBytes,
    stderrBytes: input.stderrBytes,
    ...(input.stopped ? {} : { code: "embedding.failed" }),
  };
}

export interface EmbeddingProcessOptions
  extends EmbeddingProcessDeps, EmbeddingProcessDiagnosticOptions {}

/** This object owns a single lifetime, including failed startup and bounded bind retries. */
export function createEmbeddingProcess(
  config: Pick<EmbeddingConfig, "modelPath" | "threads"> | undefined,
  recordProcess?: (
    identity: (ProcessIdentity & { nativeBuild: string }) | undefined,
  ) => Promise<void>,
  options: EmbeddingProcessOptions = {},
): EmbeddingRuntime {
  const resolveResources = options.resolveResources ?? resolveEmbeddingResources;
  const createClient = options.createClient ?? createLlamaClient;
  const spawnProcess = options.spawnProcess ?? spawn;
  const diagnostics = options.diagnostics ?? noopEmitter;
  let child: ReturnType<typeof spawn> | undefined;
  let completion: Promise<void> | undefined;
  let startTask: Promise<void> | undefined;
  let stopTask: Promise<void> | undefined;
  let client: ReturnType<typeof createLlamaClient> | undefined;
  let resources: EmbeddingResources | undefined;
  const lifetime = new AbortController();
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  function start(signal: AbortSignal, deadline: number): Promise<void> {
    if (startTask) return startTask;
    const timeout = createTimeoutSignal(Math.max(1, deadline - Date.now()));
    const combined = AbortSignal.any([signal, lifetime.signal, timeout.signal]);
    startTask = launch(combined, deadline)
      .catch((error: unknown) => {
        if (combined.aborted)
          throw new EmbeddingError(
            signal.aborted || lifetime.signal.aborted
              ? "embedding.busy"
              : "embedding.deadline-exceeded",
          );
        throw error;
      })
      .finally(() => timeout.dispose());
    return startTask;
  }
  async function launch(signal: AbortSignal, deadline: number) {
    if (!config?.modelPath) throw new EmbeddingError("embedding.not-configured");
    resources = await resolveResources(config.modelPath, signal);
    for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      const port = await reservePort();
      signal.throwIfAborted();
      const secret = randomBytes(32).toString("hex");
      const alias = randomBytes(32).toString("hex");
      await resources.assertUnchanged();
      signal.throwIfAborted();
      const nativeRunId = randomUUID();
      let readiness: "pending" | "ready" | "failed" = "pending";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const owned = spawnProcess(
        resources.executable,
        llamaArguments(config.modelPath, port, alias, config),
        {
          // Streams are continuously drained only to retain byte counts. The
          // first release does not capture raw native output, which means a
          // provider cannot leak credentials by echoing its environment.
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...platformEnvironment(),
            LLAMA_API_KEY: secret,
            LLAMA_PARENT_LIVENESS_STDIN: "1",
          },
          windowsHide: true,
        },
      );
      child = owned;
      completion = new Promise<void>((resolve) => {
        owned.once("close", (exitCode, exitSignal) => {
          const stopped = lifetime.signal.aborted;
          diagnostics.emit(
            nativeExitLogRecord({
              nativeRunId,
              ...(options.preparationId === undefined
                ? {}
                : { preparationId: options.preparationId }),
              ...(resources === undefined ? {} : { buildIdentity: resources.buildIdentity }),
              readiness,
              stopped,
              exitCode,
              signal: exitSignal,
              stdoutBytes,
              stderrBytes,
            }),
          );
          if (client) resolveExit();
          resolve();
        });
      });
      owned.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutBytes += Buffer.byteLength(chunk);
      });
      owned.stderr?.on("data", (chunk: Buffer | string) => {
        stderrBytes += Buffer.byteLength(chunk);
      });
      // A dead native child closes its pipe; never log the credential or native stderr.
      owned.stdin?.on("error", () => {});
      await new Promise<void>((resolve, reject) => {
        owned.once("spawn", resolve);
        owned.once("error", reject);
      });
      if (owned.pid === undefined) throw new EmbeddingError("embedding.failed");
      diagnostics.emit({
        time: new Date().toISOString(),
        level: "info",
        component: "backend",
        event: "native.spawned",
        nativeRunId,
        ...(options.preparationId === undefined ? {} : { preparationId: options.preparationId }),
        buildIdentity: resources.buildIdentity,
        readiness,
        stdoutBytes,
        stderrBytes,
      });
      const identity = await processIdentity(owned.pid);
      if (!identity) {
        await completion;
        continue;
      }
      signal.throwIfAborted();
      await recordProcess?.({ ...identity, nativeBuild: resources.buildIdentity });
      const candidate = createClient(port, secret, alias);
      while (Date.now() < deadline && owned.exitCode === null && owned.signalCode === null) {
        signal.throwIfAborted();
        try {
          const probeTimeout = createTimeoutSignal(
            Math.min(STARTUP_PROBE_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
          );
          const probeSignal = AbortSignal.any([signal, probeTimeout.signal]);
          // Native /health is unauthenticated; it cannot establish this process's readiness.
          try {
            await candidate.encode("hello", probeSignal);
            await resources.assertUnchanged();
            signal.throwIfAborted();
            if (owned.exitCode !== null || owned.signalCode !== null) break;
            client = candidate;
            readiness = "ready";
            diagnostics.emit({
              time: new Date().toISOString(),
              level: "info",
              component: "backend",
              event: "native.readiness-confirmed",
              nativeRunId,
              ...(options.preparationId === undefined
                ? {}
                : { preparationId: options.preparationId }),
              buildIdentity: resources.buildIdentity,
              readiness,
              stdoutBytes,
              stderrBytes,
            });
            return;
          } finally {
            probeTimeout.dispose();
          }
        } catch (error) {
          if (
            error instanceof EmbeddingError &&
            (error.code === "embedding.resource-invalid" ||
              error.code === "embedding.native-resource-invalid")
          )
            throw error;
          signal.throwIfAborted();
          await Bun.sleep(STARTUP_POLL_MS);
        }
      }
      if (owned.exitCode === null && owned.signalCode === null)
        throw new EmbeddingError("embedding.deadline-exceeded");
      // Only a confirmed exited child can be replaced, never an existing listener.
      await completion;
    }
    throw new EmbeddingError("embedding.failed");
  }
  function stop(deadline: number): Promise<void> {
    if (stopTask) return stopTask;
    lifetime.abort();
    stopTask = (async () => {
      const startupSettled =
        !startTask || (await waitForSettlement(startTask, deadline - FORCE_KILL_WAIT_MS));
      const owned = child;
      if (owned && owned.exitCode === null && owned.signalCode === null) {
        owned.kill("SIGTERM");
        await waitForSettlement(completion!, deadline - FORCE_KILL_WAIT_MS);
        if (owned.exitCode === null && owned.signalCode === null) owned.kill("SIGKILL");
        if (!(await waitForSettlement(completion!, deadline)))
          throw new EmbeddingError("embedding.deadline-exceeded");
      }
      if (!startupSettled) throw new EmbeddingError("embedding.deadline-exceeded");
      owned?.stdin?.destroy();
      resolveExit();
      await recordProcess?.(undefined);
    })().finally(() => {
      stopTask = undefined;
    });
    return stopTask;
  }
  async function checkedClient() {
    if (!client || lifetime.signal.aborted) throw new EmbeddingError("embedding.not-loaded");
    await resources!.assertUnchanged();
    return client;
  }
  return {
    start,
    stop,
    exited,
    encode: async (text, signal) => {
      const vector = await (await checkedClient()).encode(text, signal);
      await resources!.assertUnchanged();
      return vector;
    },
  };
}
async function reservePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error || !address || typeof address === "string")
          reject(new EmbeddingError("embedding.failed"));
        else resolve(address.port);
      });
    });
  });
}
