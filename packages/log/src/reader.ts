/* eslint-disable no-await-in-loop -- Traverse and read bounded log files in order; prune oldest files first. */
import { lstat, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

import { isLogLevel, isTraceId, type LogLevel, type TraceId } from "./context.js";
import type { LogRecord } from "./record.js";

const MAX_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_RECORDS = 100;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_RETENTION_FILES = 1_000;
const DEFAULT_RETENTION_BYTES = 20 * 1_024 * 1_024;

export interface ReadManagedLogsOptions {
  readonly rootDirectory: string;
  readonly source?: string;
  readonly traceId?: TraceId;
  readonly level?: LogLevel;
  readonly limit?: number;
}

export interface ManagedLogReadResult {
  readonly records: readonly LogRecord[];
  readonly missing: readonly string[];
  readonly truncated: boolean;
}

export interface PruneManagedLogsOptions {
  readonly rootDirectory: string;
  readonly now?: number;
  readonly maxAgeDays?: number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
}

export interface PruneManagedLogsResult {
  readonly deletedFiles: number;
  readonly deletedBytes: number;
}

interface ManagedFile {
  readonly path: string;
  readonly relativePath: string;
  readonly size: number;
  readonly modifiedMs: number;
}

function record(value: unknown): value is LogRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.time === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.message === "string" &&
    isLogLevel(candidate.level) &&
    (candidate.traceId === undefined || isTraceId(candidate.traceId))
  );
}

async function listManagedFiles(rootDirectory: string): Promise<ManagedFile[]> {
  const files: ManagedFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !/\.jsonl(?:\.\d+)?$/.test(entry.name)) continue;
      const info = await stat(path);
      files.push({
        path,
        relativePath: relative(rootDirectory, path),
        size: info.size,
        modifiedMs: info.mtimeMs,
      });
    }
  }
  const root = await lstat(rootDirectory).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (root === undefined) return files;
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Managed log root is unsafe.");
  await visit(rootDirectory);
  return files;
}

export async function readManagedLogs(
  options: ReadManagedLogsOptions,
): Promise<ManagedLogReadResult> {
  const limit = options.limit ?? DEFAULT_MAX_RECORDS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
    throw new RangeError("Log limit must be between 1 and 1000.");
  const missing: string[] = [];
  let files: ManagedFile[];
  try {
    files = await listManagedFiles(options.rootDirectory);
  } catch {
    return { records: [], missing: ["log-root-unavailable"], truncated: false };
  }
  if (files.length === 0) return { records: [], missing: ["log-files-missing"], truncated: false };
  const records: LogRecord[] = [];
  let truncated = false;
  for (const file of files.sort((left, right) => left.modifiedMs - right.modifiedMs)) {
    if (file.size > MAX_FILE_BYTES) {
      missing.push(`log-file-oversized:${file.relativePath}`);
      continue;
    }
    let text: string;
    try {
      text = await readFile(file.path, "utf8");
    } catch {
      missing.push(`log-file-unreadable:${file.relativePath}`);
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!record(parsed)) {
          missing.push(`log-record-invalid:${file.relativePath}`);
          continue;
        }
        if (options.source !== undefined && parsed.source !== options.source) continue;
        if (options.traceId !== undefined && parsed.traceId !== options.traceId) continue;
        if (options.level !== undefined && parsed.level !== options.level) continue;
        records.push(parsed);
        if (records.length > limit) {
          records.shift();
          truncated = true;
        }
      } catch {
        if (index !== lines.length - 1) missing.push(`log-file-corrupt:${file.relativePath}`);
      }
    }
  }
  return {
    records: records.sort((left, right) => left.time.localeCompare(right.time)),
    missing: [...new Set(missing)],
    truncated,
  };
}

/** Deletes only safe `.jsonl` files discovered below the managed log root. */
export async function pruneManagedLogs(
  options: PruneManagedLogsOptions,
): Promise<PruneManagedLogsResult> {
  const now = options.now ?? Date.now();
  const maxAgeMs = (options.maxAgeDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000;
  const maxFiles = options.maxFiles ?? DEFAULT_RETENTION_FILES;
  const maxBytes = options.maxBytes ?? DEFAULT_RETENTION_BYTES;
  const files = await listManagedFiles(options.rootDirectory);
  let totalBytes = files.reduce((total, file) => total + file.size, 0);
  let retained = files.length;
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const file of [...files].sort((left, right) => left.modifiedMs - right.modifiedMs)) {
    const expired = now - file.modifiedMs > maxAgeMs;
    const overLimit = retained > maxFiles || totalBytes > maxBytes;
    if (!expired && !overLimit) continue;
    await unlink(file.path);
    retained -= 1;
    totalBytes -= file.size;
    deletedFiles += 1;
    deletedBytes += file.size;
  }
  return { deletedFiles, deletedBytes };
}
