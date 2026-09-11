import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { backendSettingsSchema } from "../config/model";
import { embeddingConfigSchema } from "../config/embedding";
import { BackendError } from "../protocol/errors";

const MAX_RUNTIME_RECORD_BYTES = 4_096;

export const runtimeRecordSchema = z
  .strictObject({
    instanceId: z.string().regex(/^[a-f0-9-]{36}$/),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    buildIdentity: z.string().min(1).max(128),
    controlVersion: z.number().int(),
    businessVersion: z.number().int(),
    pid: z.number().int().min(1),
    startedAt: z.string().min(1),
    settings: backendSettingsSchema.optional(),
    modelProcess: z
      .strictObject({
        pid: z.int().positive(),
        startedAt: z.string().min(1),
        nativeBuild: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    embedding: embeddingConfigSchema.optional(),
  })
  .refine(
    (record) => Buffer.byteLength(JSON.stringify(record), "utf8") <= MAX_RUNTIME_RECORD_BYTES,
  );
export type RuntimeRecord = z.infer<typeof runtimeRecordSchema>;
export function statePath(directory: string): string {
  return join(directory, "instance.json");
}
export function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Parent components may be public, but none may redirect through a symlink. */
export async function checkDirectory(directory: string, create = false): Promise<boolean> {
  const absolute = resolve(directory);
  const parent = dirname(absolute);
  if (parent !== absolute) {
    const present = await checkPath(parent);
    if (!present && !create) return false;
    if (!present) await mkdir(parent, { recursive: true, mode: 0o700 });
  }
  try {
    if (create) await mkdir(absolute, { mode: 0o700 });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  try {
    const info = await lstat(absolute);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new BackendError("backend.state-invalid");
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
async function checkPath(path: string): Promise<boolean> {
  const parent = dirname(path);
  if (parent !== path && !(await checkPath(parent))) return false;
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new BackendError("backend.state-invalid");
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
export async function assertPrivateFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      info.nlink !== 1
    )
      throw new BackendError("backend.state-invalid");
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
export async function readRecord(directory: string): Promise<RuntimeRecord | undefined> {
  if (!(await checkDirectory(directory))) return undefined;
  const path = statePath(directory);
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
      info.size > MAX_RUNTIME_RECORD_BYTES ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new BackendError("backend.state-invalid");
    const rawText = await file.readFile("utf8");
    const raw: unknown = JSON.parse(rawText);
    const result = runtimeRecordSchema.safeParse(raw);
    if (!result.success) throw new BackendError("backend.state-invalid");
    return result.data;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError("backend.state-invalid", { cause: error });
  } finally {
    await file.close();
  }
}
export async function writeRecord(directory: string, record: RuntimeRecord): Promise<void> {
  const serialized = JSON.stringify(record);
  if (!runtimeRecordSchema.safeParse(record).success)
    throw new BackendError("backend.state-invalid");
  const temporary = join(directory, `${record.instanceId}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(serialized);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, statePath(directory));
}
export async function removeRecord(directory: string, instanceId: string): Promise<void> {
  const current = await readRecord(directory);
  if (current?.instanceId === instanceId) {
    try {
      await unlink(statePath(directory));
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
}
