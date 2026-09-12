import { waitForSettlement } from "../lifecycle/deadline";
import { llamaArguments } from "./llama-options";
/* eslint-disable no-await-in-loop -- Child startup and shutdown polling are sequential and bounded. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
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

/** This object owns a single lifetime, including failed startup and bounded bind retries. */
export function createEmbeddingProcess(
  config: Pick<EmbeddingConfig, "modelPath" | "threads"> | undefined,
  recordProcess?: (
    identity: (ProcessIdentity & { nativeBuild: string }) | undefined,
  ) => Promise<void>,
): EmbeddingRuntime {
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
    const combined = AbortSignal.any([
      signal,
      lifetime.signal,
      AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    ]);
    startTask = launch(combined, deadline).catch((error: unknown) => {
      if (combined.aborted)
        throw new EmbeddingError(
          signal.aborted || lifetime.signal.aborted
            ? "embedding.busy"
            : "embedding.deadline-exceeded",
        );
      throw error;
    });
    return startTask;
  }
  async function launch(signal: AbortSignal, deadline: number) {
    if (!config?.modelPath) throw new EmbeddingError("embedding.not-configured");
    resources = await resolveEmbeddingResources(config.modelPath, signal);
    for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      const port = await reservePort();
      signal.throwIfAborted();
      const secret = randomBytes(32).toString("hex");
      const alias = randomBytes(32).toString("hex");
      await resources.assertUnchanged();
      signal.throwIfAborted();
      const owned = spawn(
        resources.executable,
        llamaArguments(config.modelPath, port, alias, config),
        {
          stdio: ["pipe", "ignore", "ignore"],
          env: { ...platformEnvironment(), LLAMA_API_KEY: secret },
          windowsHide: true,
        },
      );
      child = owned;
      completion = new Promise<void>((resolve) => {
        owned.once("close", () => {
          if (client) resolveExit();
          resolve();
        });
      });
      // A dead native child closes its pipe; never log the credential or native stderr.
      owned.stdin?.on("error", () => {});
      await new Promise<void>((resolve, reject) => {
        owned.once("spawn", resolve);
        owned.once("error", reject);
      });
      if (owned.pid === undefined) throw new EmbeddingError("embedding.failed");
      const identity = await processIdentity(owned.pid);
      if (!identity) {
        await completion;
        continue;
      }
      signal.throwIfAborted();
      await recordProcess?.({ ...identity, nativeBuild: resources.buildIdentity });
      const candidate = createLlamaClient(port, secret, alias);
      while (Date.now() < deadline && owned.exitCode === null && owned.signalCode === null) {
        signal.throwIfAborted();
        try {
          const probeSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(
              Math.min(STARTUP_PROBE_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
            ),
          ]);
          // Native /health is unauthenticated; it cannot establish this process's readiness.
          await candidate.encode("hello", probeSignal);
          await resources.assertUnchanged();
          signal.throwIfAborted();
          if (owned.exitCode !== null || owned.signalCode !== null) break;
          client = candidate;
          return;
        } catch (error) {
          if (error instanceof EmbeddingError && error.code === "embedding.resource-invalid")
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
