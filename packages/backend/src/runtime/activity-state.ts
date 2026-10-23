import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { BackendError } from "../protocol/errors";
import { PROTOCOL_VERSION } from "../protocol/constants";
import { sqliteExclusiveLock } from "./coordination/sqlite-exclusive-lock";
import { assertPrivateFile, checkDirectory, hasCode } from "./runtime-state";
import type { ProcessIdentity } from "./process-identity";

const MAX_ACTIVITY_RECORD_BYTES = 8_192;
const activityKinds = [
  "daemon-startup",
  "model-preparation",
  "index-operation",
  "handoff-stop",
] as const;

export type RuntimeActivityKind = (typeof activityKinds)[number];
export type RuntimeActivityReason = "idle" | "active-long-task" | "unknown-activity";

const processIdentitySchema = z.strictObject({
  pid: z.int().positive(),
  startedAt: z.string().min(1).max(256),
});

export const hostTaskLeaseSchema = z.strictObject({
  leaseId: z.string().uuid(),
  owner: processIdentitySchema,
  heartbeatAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type HostTaskLease = z.infer<typeof hostTaskLeaseSchema>;

export const runtimeActivityRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    instanceId: z.string().uuid(),
    activities: z.array(z.enum(activityKinds)).max(activityKinds.length),
    leases: z.array(hostTaskLeaseSchema).max(32),
  })
  .superRefine((record, context) => {
    if (new Set(record.activities).size !== record.activities.length) {
      context.addIssue({ code: "custom", message: "Runtime activities must be unique." });
    }
    if (new Set(record.leases.map((lease) => lease.leaseId)).size !== record.leases.length) {
      context.addIssue({ code: "custom", message: "Runtime lease IDs must be unique." });
    }
    if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_ACTIVITY_RECORD_BYTES) {
      context.addIssue({ code: "custom", message: "Runtime activity record is too large." });
    }
  });
export type RuntimeActivityRecord = z.infer<typeof runtimeActivityRecordSchema>;

export type RuntimeActivityAssessment =
  | { readonly state: "idle"; readonly reason: "idle" }
  | { readonly state: "active"; readonly reason: "active-long-task" }
  | { readonly state: "unknown"; readonly reason: "unknown-activity" };

export interface LeaseGrant {
  readonly leaseId: string;
  readonly expiresAt: string;
}

export function activityPath(directory: string): string {
  return join(directory, "activity.json");
}

/** Separate from lifecycle start/stop locking so a starting daemon can publish readiness safely. */
export async function withActivityLock<T>(
  directory: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T> {
  return sqliteExclusiveLock.withLock(join(directory, "activity-lock"), timeoutMs, run);
}

export async function readActivityRecord(
  directory: string,
): Promise<RuntimeActivityRecord | undefined> {
  if (!(await checkDirectory(directory))) return undefined;
  const path = activityPath(directory);
  if (!(await assertPrivateFile(path))) return undefined;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (error: unknown) => {
      if (hasCode(error, "ENOENT")) return undefined;
      throw new BackendError("backend.state-invalid", { cause: error });
    },
  );
  if (file === undefined) return undefined;
  try {
    const info = await file.stat();
    if (
      info.size > MAX_ACTIVITY_RECORD_BYTES ||
      (process.platform !== "win32" &&
        (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
    )
      throw new BackendError("backend.state-invalid");
    const parsed = runtimeActivityRecordSchema.safeParse(JSON.parse(await file.readFile("utf8")));
    if (!parsed.success) throw new BackendError("backend.state-invalid");
    return parsed.data;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError("backend.state-invalid", { cause: error });
  } finally {
    await file.close();
  }
}

export async function writeActivityRecord(
  directory: string,
  record: z.input<typeof runtimeActivityRecordSchema>,
): Promise<void> {
  const parsed = runtimeActivityRecordSchema.safeParse(record);
  if (!parsed.success) throw new BackendError("backend.state-invalid");
  await checkDirectory(directory, true);
  const serialized = JSON.stringify(parsed.data);
  const temporary = join(directory, `activity-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(serialized);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, activityPath(directory));
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function initializeActivityRecord(
  directory: string,
  instanceId: string,
): Promise<RuntimeActivityRecord> {
  const record: RuntimeActivityRecord = {
    schemaVersion: 1,
    instanceId,
    activities: ["daemon-startup"],
    leases: [],
  };
  await writeActivityRecord(directory, record);
  return record;
}

export async function setRuntimeActivity(
  directory: string,
  instanceId: string,
  kind: RuntimeActivityKind,
  active: boolean,
): Promise<RuntimeActivityRecord> {
  const current = await requiredActivityRecord(directory, instanceId);
  const activities = new Set(current.activities);
  if (active && kind !== "handoff-stop" && activities.has("handoff-stop"))
    throw new BackendError("backend.busy");
  if (active) activities.add(kind);
  else activities.delete(kind);
  const next: RuntimeActivityRecord = {
    ...current,
    activities: [...activities].sort(),
  };
  await writeActivityRecord(directory, next);
  return next;
}

export async function grantTaskLease(
  directory: string,
  instanceId: string,
  owner: ProcessIdentity,
  ttlMs: number,
  now = Date.now(),
  protocolVersion = PROTOCOL_VERSION,
): Promise<LeaseGrant> {
  const current = await requiredActivityRecord(directory, instanceId);
  const leaseId = randomUUID();
  const expiresAt = new Date(now + validateLeaseDuration(ttlMs)).toISOString();
  const next: RuntimeActivityRecord = {
    ...current,
    leases: [
      ...current.leases.filter((lease) => protocolVersion < 4 || Date.parse(lease.expiresAt) > now),
      {
        leaseId,
        owner,
        heartbeatAt: new Date(now).toISOString(),
        expiresAt,
      },
    ],
  };
  await writeActivityRecord(directory, next);
  return { leaseId, expiresAt };
}

export async function renewTaskLease(
  directory: string,
  instanceId: string,
  leaseId: string,
  owner: ProcessIdentity,
  ttlMs: number,
  now = Date.now(),
  protocolVersion = PROTOCOL_VERSION,
): Promise<LeaseGrant> {
  if (!z.string().uuid().safeParse(leaseId).success)
    throw new BackendError("backend.invalid-request");
  const current = await requiredActivityRecord(directory, instanceId);
  const currentLease = current.leases.find((lease) => lease.leaseId === leaseId);
  if (currentLease === undefined) throw new BackendError("backend.operation-expired");
  const expiresAt = new Date(now + validateLeaseDuration(ttlMs)).toISOString();
  const next: RuntimeActivityRecord = {
    ...current,
    leases: current.leases
      .filter(
        (lease) =>
          protocolVersion < 4 || lease.leaseId === leaseId || Date.parse(lease.expiresAt) > now,
      )
      .map((lease) =>
        lease.leaseId === leaseId
          ? { ...lease, owner, heartbeatAt: new Date(now).toISOString(), expiresAt }
          : lease,
      ),
  };
  await writeActivityRecord(directory, next);
  return { leaseId, expiresAt };
}

export async function releaseTaskLease(
  directory: string,
  instanceId: string,
  leaseId: string,
): Promise<void> {
  if (!z.string().uuid().safeParse(leaseId).success)
    throw new BackendError("backend.invalid-request");
  const current = await requiredActivityRecord(directory, instanceId);
  if (!current.leases.some((lease) => lease.leaseId === leaseId))
    throw new BackendError("backend.operation-expired");
  await writeActivityRecord(directory, {
    ...current,
    leases: current.leases.filter((lease) => lease.leaseId !== leaseId),
  });
}

export async function removeActivityRecord(directory: string, instanceId: string): Promise<void> {
  const current = await readActivityRecord(directory);
  if (current?.instanceId !== instanceId) return;
  try {
    await unlink(activityPath(directory));
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export function assessRuntimeActivity(
  record: RuntimeActivityRecord | undefined,
  instanceId: string,
  now = Date.now(),
): RuntimeActivityAssessment {
  if (record === undefined || record.instanceId !== instanceId)
    return { state: "unknown", reason: "unknown-activity" };
  if (record.activities.length > 0) return { state: "active", reason: "active-long-task" };
  if (record.leases.some((lease) => Date.parse(lease.expiresAt) <= now))
    return { state: "unknown", reason: "unknown-activity" };
  if (record.leases.length > 0) return { state: "active", reason: "active-long-task" };
  return { state: "idle", reason: "idle" };
}

/** v4 lease semantics: expired leases no longer protect a daemon from an idle handoff. */
export function assessRuntimeActivityV4(
  record: RuntimeActivityRecord | undefined,
  instanceId: string,
  now = Date.now(),
): RuntimeActivityAssessment {
  if (record === undefined || record.instanceId !== instanceId)
    return { state: "unknown", reason: "unknown-activity" };
  if (record.activities.length > 0) return { state: "active", reason: "active-long-task" };
  if (record.leases.some((lease) => Date.parse(lease.expiresAt) > now))
    return { state: "active", reason: "active-long-task" };
  return { state: "idle", reason: "idle" };
}

async function requiredActivityRecord(
  directory: string,
  instanceId: string,
): Promise<RuntimeActivityRecord> {
  const current = await readActivityRecord(directory);
  if (current === undefined || current.instanceId !== instanceId)
    throw new BackendError("backend.state-invalid");
  return current;
}

function validateLeaseDuration(ttlMs: number): number {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000)
    throw new BackendError("backend.invalid-request");
  return ttlMs;
}
