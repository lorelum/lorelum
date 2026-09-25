/* eslint-disable no-await-in-loop -- Process lifecycle polling must observe each preceding attempt before retrying. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";

import {
  defaultDiagnosticsFallbackDirectory,
  defaultRuntimeDirectory,
  resolveBackendSettings,
  resolveEmbeddingConfig,
  daemonEnvironment,
  type BackendConfig,
} from "../config";
import { createBackendClient, type BackendClient } from "../client";
import { BACKEND_URL, PROTOCOL_VERSION } from "../protocol/constants";
import { BackendError, type BackendCompatibilityRecovery } from "../protocol/errors";
import type { BackendStatus } from "../modules/backend/model";
import {
  assessRuntimeActivity,
  grantTaskLease,
  initializeActivityRecord,
  readActivityRecord,
  releaseTaskLease,
  removeActivityRecord,
  renewTaskLease,
  setRuntimeActivity,
  withActivityLock,
  type LeaseGrant,
  type RuntimeActivityAssessment,
  type RuntimeActivityReason,
} from "./activity-state";
import {
  isDirectChildProcess,
  isSameProcess,
  processIdentity,
  type ProcessIdentity,
} from "./process-identity";
import { readRecord, removeRecord, writeRecord, type RuntimeRecord } from "./runtime-state";
import { withStartupLock } from "./startup-lock";

export interface BackendSupervisorOptions {
  readonly config?: BackendConfig;
  readonly buildIdentity: string;
  readonly command: readonly string[];
  /** Optional child display name for hosts that honor spawn argv0. */
  readonly daemonArgv0?: string;
  /** Internal test injection, never exposed as CLI flags or Store config. */
  readonly runtimeDirectory?: string;
  /** Internal lifecycle-test override; released CLIs retain the user-level log root. */
  readonly logDirectory?: string;
  /** Internal lifecycle-test override for the designed diagnostics fallback. */
  readonly fallbackLogDirectory?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Internal lifecycle-test injection; never exposed through CLI configuration. */
  readonly createClient?: (record: RuntimeRecord, deadline?: number) => BackendClient;
  /** Internal compatibility-test override; released CLIs always use PROTOCOL_VERSION. */
  readonly protocolVersion?: number;
}

export interface BackendHandoffResult {
  readonly state: "stopped" | "deferred";
  readonly reason?: Exclude<RuntimeActivityReason, "idle">;
}

export interface BackendSupervisor {
  start(): Promise<BackendStatus>;
  status(): Promise<BackendStatus>;
  /** Explicit operator action. It may stop a verified protocol-mismatched lifecycle. */
  stop(): Promise<BackendStatus>;
  /** Safe automatic handoff. It never signals an active or unverifiable lifecycle. */
  stopIfIdle(): Promise<BackendHandoffResult>;
  inspectCompatibilityRecovery(): Promise<BackendCompatibilityRecovery>;
  acquireTaskLease(ttlMs: number): Promise<LeaseGrant>;
  renewTaskLease(leaseId: string, ttlMs: number): Promise<LeaseGrant>;
  releaseTaskLease(leaseId: string): Promise<void>;
}

const stopped: BackendStatus = { state: "stopped", model: "unloaded" };
const FORCE_TERMINATION_WAIT_MS = 1_000;

export function createBackendSupervisor(options: BackendSupervisorOptions): BackendSupervisor {
  const directory =
    options.runtimeDirectory ?? options.config?.runtimeDirectory ?? defaultRuntimeDirectory();
  const logDirectory =
    options.logDirectory ??
    (options.runtimeDirectory === undefined ? undefined : join(directory, "logs"));
  // Explicit test-injected roots must stay isolated from the real home
  // fallback (the CLI-side rule); production keeps the designed location.
  const fallbackLogDirectory =
    options.fallbackLogDirectory ??
    (options.logDirectory !== undefined
      ? join(dirname(options.logDirectory), "fallback-diagnostics")
      : options.runtimeDirectory !== undefined
        ? join(directory, "fallback-diagnostics")
        : defaultDiagnosticsFallbackDirectory());
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
  const client = (record: RuntimeRecord, deadline?: number) =>
    options.createClient?.(record, deadline) ??
    createBackendClient({
      identity: record,
      secret: record.secret,
      buildIdentity: options.buildIdentity,
      baseUrl,
      timeoutMs: Math.max(
        1,
        Math.min(
          settings.requestTimeoutMs,
          deadline === undefined ? settings.requestTimeoutMs : deadline - Date.now(),
        ),
      ),
      ...(options.protocolVersion === undefined
        ? {}
        : { protocolVersion: options.protocolVersion }),
    });

  async function status(): Promise<BackendStatus> {
    const record = await readRecord(directory);
    if (record === undefined || !(await isSameProcess(record))) {
      if (await isListening(address)) throw new BackendError("backend.port-conflict");
      return stopped;
    }
    return client(record).status();
  }

  async function inspectCompatibilityRecovery(): Promise<BackendCompatibilityRecovery> {
    try {
      const record = await readRecord(directory);
      if (record === undefined || !(await isSameProcess(record)))
        return deferred("unknown-activity");
      const assessment = await withActivityLock(directory, timeoutMs, () =>
        inspectActivity(record),
      );
      return assessment.state === "idle"
        ? {
            action: "backend.stop-if-idle",
            automation: "auto",
            reason: "idle",
            retry: "original-command",
          }
        : deferred(assessment.reason);
    } catch {
      return deferred("unknown-activity");
    }
  }

  async function inspectActivity(record: RuntimeRecord): Promise<RuntimeActivityAssessment> {
    if (
      record.modelProcess !== undefined &&
      !(await isDirectChildProcess(record.modelProcess, record))
    ) {
      return { state: "unknown", reason: "unknown-activity" };
    }
    try {
      return assessRuntimeActivity(await readActivityRecord(directory), record.instanceId);
    } catch {
      return { state: "unknown", reason: "unknown-activity" };
    }
  }

  async function withVerifiedRecord<T>(run: (record: RuntimeRecord) => Promise<T>): Promise<T> {
    return withStartupLock(directory, timeoutMs, async () => {
      const record = await readRecord(directory);
      if (record === undefined || !(await isSameProcess(record))) {
        if (await isListening(address)) throw new BackendError("backend.port-conflict");
        throw new BackendError("backend.unavailable");
      }
      return run(record);
    });
  }

  return {
    status,
    async start() {
      const deadline = Date.now() + timeoutMs;
      return withStartupLock(directory, timeoutMs, async () => {
        const previous = await readRecord(directory);
        if (previous !== undefined && (await isSameProcess(previous))) {
          if (Date.now() >= deadline) throw new BackendError("backend.deadline-exceeded");
          const current = await client(previous, deadline).status();
          if (current.state !== "ready") throw new BackendError("backend.busy");
          return current;
        }
        if (await isListening(address)) throw new BackendError("backend.port-conflict");
        if (previous !== undefined) {
          await removeRecord(directory, previous.instanceId);
          await removeActivityRecord(directory, previous.instanceId);
        }
        if (Date.now() >= deadline) throw new BackendError("backend.deadline-exceeded");
        return launch(deadline);
      });
    },
    async stop() {
      // Read-only stopped fast path: status/stop never create a runtime directory.
      if ((await readRecord(directory)) === undefined) return status();
      return withStartupLock(directory, timeoutMs, stopLocked);
    },
    async stopIfIdle() {
      if ((await readRecord(directory)) === undefined) return { state: "stopped" };
      return withStartupLock(directory, timeoutMs, async () => {
        const record = await readRecord(directory);
        if (record === undefined) return { state: "stopped" };
        if (!(await isSameProcess(record))) {
          if (await isListening(address)) return { state: "deferred", reason: "unknown-activity" };
          await removeRecord(directory, record.instanceId);
          await removeActivityRecord(directory, record.instanceId);
          return { state: "stopped" };
        }
        const assessment = await withActivityLock(directory, timeoutMs, async () => {
          const current = await inspectActivity(record);
          if (current.state !== "idle") return current;
          await setRuntimeActivity(directory, record.instanceId, "handoff-stop", true);
          return current;
        });
        if (assessment.state !== "idle") return { state: "deferred", reason: assessment.reason };
        try {
          await stopVerified(record);
          return { state: "stopped" };
        } catch (error) {
          await withActivityLock(directory, timeoutMs, async () => {
            await setRuntimeActivity(directory, record.instanceId, "handoff-stop", false).catch(
              () => undefined,
            );
          });
          throw error;
        }
      });
    },
    acquireTaskLease: (ttlMs) =>
      withVerifiedRecord(async (record) => {
        const owner = await currentProcessIdentity();
        return withActivityLock(directory, timeoutMs, () =>
          grantTaskLease(directory, record.instanceId, owner, ttlMs),
        );
      }),
    renewTaskLease: (leaseId, ttlMs) =>
      withVerifiedRecord(async (record) => {
        const owner = await currentProcessIdentity();
        return withActivityLock(directory, timeoutMs, () =>
          renewTaskLease(directory, record.instanceId, leaseId, owner, ttlMs),
        );
      }),
    releaseTaskLease: (leaseId) =>
      withVerifiedRecord((record) =>
        withActivityLock(directory, timeoutMs, () =>
          releaseTaskLease(directory, record.instanceId, leaseId),
        ),
      ),
    inspectCompatibilityRecovery,
  };

  async function stopLocked(): Promise<BackendStatus> {
    const record = await readRecord(directory);
    if (record === undefined) return status();
    if (!(await isSameProcess(record))) {
      if (await isListening(address)) throw new BackendError("backend.port-conflict");
      await removeRecord(directory, record.instanceId);
      await removeActivityRecord(directory, record.instanceId);
      return stopped;
    }
    await stopVerified(record);
    return stopped;
  }

  async function stopVerified(record: RuntimeRecord): Promise<void> {
    const lifecycle = await verifiedLifecycle(record);
    const deadline = shutdownDeadline(lifecycle.daemon);
    if (lifecycle.daemon.protocolVersion !== (options.protocolVersion ?? PROTOCOL_VERSION)) {
      await stopProtocolMismatchedLifecycle(lifecycle.daemon, lifecycle.targets, deadline);
      await removeRecord(directory, lifecycle.daemon.instanceId);
      await removeActivityRecord(directory, lifecycle.daemon.instanceId);
      return;
    }
    await client(lifecycle.daemon).stop();
    if (!(await waitForExit(lifecycle.targets, deadline)))
      throw new BackendError("backend.deadline-exceeded");
    await removeRecord(directory, lifecycle.daemon.instanceId);
    await removeActivityRecord(directory, lifecycle.daemon.instanceId);
  }

  async function stopProtocolMismatchedLifecycle(
    daemon: RuntimeRecord,
    targets: readonly ProcessIdentity[],
    deadline: number,
  ): Promise<void> {
    await signalProcess(daemon, "SIGTERM");
    if (await waitForExit(targets, deadline)) return;

    for (const target of targets) {
      if (await isSameProcess(target)) await signalProcess(target, "SIGKILL");
    }
    if (!(await waitForExit(targets, Date.now() + FORCE_TERMINATION_WAIT_MS)))
      throw new BackendError("backend.deadline-exceeded");
  }

  async function verifiedLifecycle(record: RuntimeRecord): Promise<{
    readonly daemon: RuntimeRecord;
    readonly targets: readonly ProcessIdentity[];
  }> {
    const current = await readRecord(directory);
    if (
      current === undefined ||
      current.instanceId !== record.instanceId ||
      !(await isSameProcess(current))
    )
      throw new BackendError("backend.state-invalid");
    const targets: ProcessIdentity[] = [current];
    if (current.modelProcess !== undefined) {
      if (!(await isDirectChildProcess(current.modelProcess, current)))
        throw new BackendError("backend.state-invalid");
      targets.push(current.modelProcess);
    }
    return { daemon: current, targets };
  }

  function shutdownDeadline(record: RuntimeRecord): number {
    return (
      Date.now() +
      resolveBackendSettings(record.settings).shutdownTimeoutMs +
      settings.requestTimeoutMs +
      1_000
    );
  }

  async function launch(deadline: number): Promise<BackendStatus> {
    const executable = options.command[0];
    if (!executable) throw new BackendError("backend.invalid-request");
    const instanceId = randomUUID();
    const child = spawn(executable, options.command.slice(1), {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      ...(options.daemonArgv0 === undefined ? {} : { argv0: options.daemonArgv0 }),
      env: daemonEnvironment({
        runtimeDirectory: directory,
        instanceId,
        port: Number(address.port || 80),
        ...(logDirectory === undefined ? {} : { logDirectory }),
        fallbackLogDirectory,
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
        protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
      };
      await writeRecord(directory, record);
      await withActivityLock(directory, timeoutMs, () =>
        initializeActivityRecord(directory, instanceId),
      );
      // Child cannot bind until its durable ownership records are published.
      child.stdin?.end(instanceId);
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          if (await isListening(address)) throw new BackendError("backend.port-conflict");
          throw new BackendError("backend.failed");
        }
        try {
          const result = await client(record, deadline).status();
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
      await removeActivityRecord(directory, instanceId);
      if (error instanceof BackendError) throw error;
      throw new BackendError("backend.failed", { cause: error });
    }
  }
}

function deferred(reason: Exclude<RuntimeActivityReason, "idle">): BackendCompatibilityRecovery {
  return {
    action: "backend.stop-if-idle",
    automation: "defer",
    reason,
    retry: "original-command",
  };
}

async function currentProcessIdentity(): Promise<ProcessIdentity> {
  const owner = await processIdentity(process.pid);
  if (owner === undefined) throw new BackendError("backend.state-invalid");
  return owner;
}

async function signalProcess(
  target: ProcessIdentity,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  if (!(await isSameProcess(target))) throw new BackendError("backend.state-invalid");
  try {
    process.kill(target.pid, signal);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ESRCH")
      return;
    throw new BackendError("backend.state-invalid", { cause: error });
  }
}

async function waitForExit(
  targets: readonly ProcessIdentity[],
  deadline: number,
): Promise<boolean> {
  while (true) {
    const running = await Promise.all(targets.map((target) => isSameProcess(target)));
    if (!running.some(Boolean)) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(25);
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
