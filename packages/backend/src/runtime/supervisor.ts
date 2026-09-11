/* eslint-disable no-await-in-loop -- Process lifecycle polling must observe each preceding attempt before retrying. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  defaultRuntimeDirectory,
  resolveBackendSettings,
  resolveEmbeddingConfig,
  daemonEnvironment,
  type BackendConfig,
} from "../config";
import { createBackendClient } from "../client";
import { BACKEND_URL, PROTOCOL_VERSION } from "../protocol/constants";
import { BackendError } from "../protocol/errors";
import type { BackendStatus } from "../modules/backend/model";
import { isSameProcess, processIdentity } from "./process-identity";
import { readRecord, removeRecord, writeRecord, type RuntimeRecord } from "./runtime-state";
import { withStartupLock } from "./startup-lock";

export interface BackendSupervisorOptions {
  readonly config?: BackendConfig;
  readonly buildIdentity: string;
  readonly command: readonly string[];
  /** Internal test injection, never exposed as CLI flags or Store config. */
  readonly runtimeDirectory?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}
export interface BackendSupervisor {
  start(): Promise<BackendStatus>;
  status(): Promise<BackendStatus>;
  stop(): Promise<BackendStatus>;
}
const stopped: BackendStatus = { state: "stopped", model: "unloaded" };

export function createBackendSupervisor(options: BackendSupervisorOptions): BackendSupervisor {
  const directory =
    options.runtimeDirectory ?? options.config?.runtimeDirectory ?? defaultRuntimeDirectory();
  const baseUrl = options.baseUrl ?? BACKEND_URL;
  const address = new URL(baseUrl);
  if (
    address.protocol !== "http:" ||
    address.hostname !== "127.0.0.1" ||
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash
  )
    throw new BackendError("backend.invalid-request");
  const settings = resolveBackendSettings(options.config?.settings);
  const embedding = resolveEmbeddingConfig(options.config?.embedding);
  const timeoutMs = options.timeoutMs ?? settings.startupTimeoutMs;
  const client = (record: RuntimeRecord) =>
    createBackendClient({
      identity: record,
      secret: record.secret,
      buildIdentity: options.buildIdentity,
      baseUrl,
      timeoutMs: settings.requestTimeoutMs,
    });

  async function status(): Promise<BackendStatus> {
    const record = await readRecord(directory);
    if (record === undefined || !(await isSameProcess(record))) {
      if (await isListening(address)) throw new BackendError("backend.port-conflict");
      return stopped;
    }
    return client(record).status();
  }
  return {
    status,
    async start() {
      return withStartupLock(directory, timeoutMs, async () => {
        const previous = await readRecord(directory);
        if (previous !== undefined && (await isSameProcess(previous))) {
          const current = await client(previous).status();
          if (current.state !== "ready") throw new BackendError("backend.busy");
          return current;
        }
        if (await isListening(address)) throw new BackendError("backend.port-conflict");
        if (previous !== undefined) await removeRecord(directory, previous.instanceId);
        return launch();
      });
    },
    async stop() {
      // Read-only stopped fast path: status/stop never create a runtime directory.
      if ((await readRecord(directory)) === undefined) return status();
      return withStartupLock(directory, timeoutMs, async () => {
        const record = await readRecord(directory);
        if (record === undefined) return status();
        if (!(await isSameProcess(record))) {
          if (await isListening(address)) throw new BackendError("backend.port-conflict");
          await removeRecord(directory, record.instanceId);
          return stopped;
        }
        await client(record).stop();
        const deadline =
          Date.now() +
          resolveBackendSettings(record.settings).shutdownTimeoutMs +
          settings.requestTimeoutMs +
          1_000;
        while (await isSameProcess(record)) {
          if (Date.now() >= deadline) throw new BackendError("backend.deadline-exceeded");
          await Bun.sleep(25);
        }
        await removeRecord(directory, record.instanceId);
        // Do not report ownership or availability of a newly bound unrelated process.
        return stopped;
      });
    },
  };

  async function launch(): Promise<BackendStatus> {
    const executable = options.command[0];
    if (!executable) throw new BackendError("backend.invalid-request");
    const instanceId = randomUUID();
    const child = spawn(executable, options.command.slice(1), {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      env: daemonEnvironment({
        runtimeDirectory: directory,
        instanceId,
        port: Number(address.port || 80),
      }),
    });
    const exited = childCompletion(child);
    child.stdin?.on("error", () => {
      /* Launch checks child exit; pipe failure is not success. */
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      if (child.pid === undefined) throw new BackendError("backend.failed");
      const process = await processIdentity(child.pid);
      if (process === undefined) throw new BackendError("backend.failed");
      const record: RuntimeRecord = {
        ...process,
        settings,
        ...(embedding === undefined ? {} : { embedding }),
        instanceId,
        secret: randomBytes(32).toString("hex"),
        buildIdentity: options.buildIdentity,
        protocolVersion: PROTOCOL_VERSION,
      };
      await writeRecord(directory, record);
      // Child cannot bind until its durable ownership record is published.
      child.stdin?.end(instanceId);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          if (await isListening(address)) throw new BackendError("backend.port-conflict");
          throw new BackendError("backend.failed");
        }
        try {
          const result = await client(record).status();
          if (result.state === "ready") {
            child.unref();
            return result;
          }
        } catch (error) {
          if (
            !(error instanceof BackendError) ||
            !["backend.unavailable", "backend.deadline-exceeded"].includes(error.code)
          )
            throw error;
        }
        await Bun.sleep(25);
      }
      throw new BackendError("backend.deadline-exceeded");
    } catch (error) {
      // Only the exact child launched here is terminated, never a discovered PID.
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      await removeRecord(directory, instanceId);
      if (error instanceof BackendError) throw error;
      throw new BackendError("backend.failed", { cause: error });
    }
  }
}
function childCompletion(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}
async function isListening(address: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: Number(address.port || 80) });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}
