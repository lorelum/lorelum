/* eslint-disable no-await-in-loop -- Previous-owner identity must be observed sequentially. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { isSameProcess, processIdentity, type ProcessIdentity } from "../runtime/process-identity";
import { assertPrivateFile, hasCode } from "../runtime/runtime-state";

const MAX_OWNER_BYTES = 512;
const OWNER_WAIT_MILLISECONDS = 3_000;
const ownerSchema = z.strictObject({
  pid: z.int().positive(),
  startedAt: z.string().min(1).max(128),
});

export class DownloadOwnerError extends Error {
  constructor(readonly reason: "cancelled" | "owner-active" | "process-exited") {
    super(`download owner failed: ${reason}`);
    this.name = "DownloadOwnerError";
  }
}

export function ownerPath(destination: string): string {
  return `${destination}.owner.json`;
}

export async function waitForDownloadExit(destination: string, signal: AbortSignal): Promise<void> {
  const path = ownerPath(destination);
  const previous = await readOwner(path);
  if (previous === undefined) return;

  const deadline = Date.now() + OWNER_WAIT_MILLISECONDS;
  while (await isSameProcess(previous)) {
    if (signal.aborted) throw new DownloadOwnerError("cancelled");
    if (Date.now() >= deadline) throw new DownloadOwnerError("owner-active");
    try {
      await delay(25, undefined, { signal });
    } catch {
      throw new DownloadOwnerError("cancelled");
    }
  }
  await removeOwner(path, previous);
}

export async function identifyOwner(pid: number): Promise<ProcessIdentity> {
  const identity = await processIdentity(pid);
  if (identity === undefined) throw new DownloadOwnerError("process-exited");
  return identity;
}

export async function writeOwner(destination: string, identity: ProcessIdentity): Promise<void> {
  const path = ownerPath(destination);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(ownerSchema.parse(identity));
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(serialized);
    await file.sync();
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function clearOwner(destination: string, identity: ProcessIdentity): Promise<void> {
  await removeOwner(ownerPath(destination), identity);
}

async function readOwner(path: string): Promise<ProcessIdentity | undefined> {
  try {
    if (!(await assertPrivateFile(path))) return undefined;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (info.size > MAX_OWNER_BYTES) throw new Error("owner record is too large");
      return ownerSchema.parse(JSON.parse(await file.readFile("utf8")));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function removeOwner(path: string, expected: ProcessIdentity): Promise<void> {
  const current = await readOwner(path);
  if (current?.pid !== expected.pid || current.startedAt !== expected.startedAt) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}
