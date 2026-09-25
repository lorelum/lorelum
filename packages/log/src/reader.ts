/* eslint-disable no-await-in-loop -- Managed files are processed in mtime and retention order; each read decides the next step. */
import { lstat, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

import { isLogLevel, isTraceId, type LogLevel, type TraceId } from "./context.js";
import type { LogRecord } from "./record.js";
import { hasCode } from "./sinks/safety.js";

const MAX_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_RECORDS = 100;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_RETENTION_FILES = 1_000;
const DEFAULT_RETENTION_BYTES = 20 * 1_024 * 1_024;

/** Which designed location a record or file came from. */
export type ManagedLogRoot = "primary" | "fallback";

/** Coarse reachability of one designed root at read time. */
export interface ManagedRootAvailability {
  readonly root: ManagedLogRoot;
  readonly state: "available" | "missing" | "unavailable";
}

/** A record together with the designed root it was read from. */
export interface LocatedLogRecord {
  readonly record: LogRecord;
  readonly root: ManagedLogRoot;
}

export interface ReadManagedLogsOptions {
  readonly rootDirectory: string;
  /** Designed private fallback root; records found there are labeled as such. */
  readonly fallbackRootDirectory?: string;
  readonly source?: string;
  readonly traceId?: TraceId;
  readonly level?: LogLevel;
  readonly limit?: number;
}

export interface ManagedLogReadResult {
  readonly records: readonly LogRecord[];
  readonly missing: readonly string[];
  readonly truncated: boolean;
  /** Aligned with `records`; states which designed root produced each one. */
  readonly locations: readonly ManagedLogRoot[];
  readonly rootAvailability: readonly ManagedRootAvailability[];
}

export interface PruneManagedLogsOptions {
  readonly rootDirectory: string;
  /** Pruned with the same rules as the primary root. */
  readonly fallbackRootDirectory?: string;
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

interface RootScan {
  readonly root: ManagedLogRoot;
  readonly records: readonly LocatedLogRecord[];
  readonly missing: readonly string[];
  readonly truncated: boolean;
  readonly filesFound: number;
  readonly state: ManagedRootAvailability["state"];
}

interface ScanFilters {
  readonly source?: string;
  readonly traceId?: TraceId;
  readonly level?: LogLevel;
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
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (root === undefined) return files;
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Managed log root is unsafe.");
  await visit(rootDirectory);
  return files;
}

async function scanManagedRoot(
  rootDirectory: string,
  root: ManagedLogRoot,
  filters: ScanFilters,
  limit: number,
): Promise<RootScan> {
  const markerPrefix = root === "fallback" ? "fallback:" : "";
  let files: ManagedFile[];
  try {
    files = await listManagedFiles(rootDirectory);
  } catch {
    // `listManagedFiles` reports a missing root as an empty file list, so this
    // branch means an unsafe or unreadable root: a real evidence gap.
    return {
      root,
      records: [],
      missing: [`${markerPrefix}log-root-unavailable`],
      truncated: false,
      filesFound: 0,
      state: "unavailable",
    };
  }
  if (files.length === 0) {
    return {
      root,
      records: [],
      missing: [],
      truncated: false,
      filesFound: 0,
      state: "missing",
    };
  }
  const records: LocatedLogRecord[] = [];
  const missing: string[] = [];
  let truncated = false;
  for (const file of files.sort((left, right) => left.modifiedMs - right.modifiedMs)) {
    if (file.size > MAX_FILE_BYTES) {
      missing.push(`${markerPrefix}log-file-oversized:${file.relativePath}`);
      continue;
    }
    let text: string;
    try {
      text = await readFile(file.path, "utf8");
    } catch {
      missing.push(`${markerPrefix}log-file-unreadable:${file.relativePath}`);
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!record(parsed)) {
          missing.push(`${markerPrefix}log-record-invalid:${file.relativePath}`);
          continue;
        }
        if (filters.source !== undefined && parsed.source !== filters.source) continue;
        if (filters.traceId !== undefined && parsed.traceId !== filters.traceId) continue;
        if (filters.level !== undefined && parsed.level !== filters.level) continue;
        records.push({ record: parsed, root });
        if (records.length > limit) {
          records.shift();
          truncated = true;
        }
      } catch {
        if (index !== lines.length - 1) {
          missing.push(`${markerPrefix}log-file-corrupt:${file.relativePath}`);
        }
      }
    }
  }
  return {
    root,
    records: records.sort((left, right) => left.record.time.localeCompare(right.record.time)),
    missing,
    truncated,
    filesFound: files.length,
    state: "available",
  };
}

export async function readManagedLogs(
  options: ReadManagedLogsOptions,
): Promise<ManagedLogReadResult> {
  const limit = options.limit ?? DEFAULT_MAX_RECORDS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
    throw new RangeError("Log limit must be between 1 and 1000.");
  const filters: ScanFilters = {
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    ...(options.level === undefined ? {} : { level: options.level }),
  };
  const scans = [
    await scanManagedRoot(options.rootDirectory, "primary", filters, limit),
    ...(options.fallbackRootDirectory === undefined
      ? []
      : [await scanManagedRoot(options.fallbackRootDirectory, "fallback", filters, limit)]),
  ];
  const missing = scans.flatMap((scan) => scan.missing);
  // Historical marker: no root reported unreadable and none held any managed
  // file, so the read genuinely covered an empty evidence store.
  if (scans.every((scan) => scan.state !== "unavailable" && scan.filesFound === 0)) {
    missing.push("log-files-missing");
  }
  // Both roots are disjoint trees, but an operator copying files between them
  // must not turn one invocation into duplicated evidence.
  const seen = new Set<string>();
  const located = scans
    .flatMap((scan) => scan.records)
    .filter((entry) => {
      const identity = JSON.stringify(entry.record);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) => left.record.time.localeCompare(right.record.time));
  let truncated = scans.some((scan) => scan.truncated);
  const kept = located.length > limit ? located.slice(located.length - limit) : located;
  if (kept.length < located.length) truncated = true;
  return {
    records: kept.map((entry) => entry.record),
    missing: [...new Set(missing)],
    truncated,
    locations: kept.map((entry) => entry.root),
    rootAvailability: scans.map((scan) => ({ root: scan.root, state: scan.state })),
  };
}

/** Deletes only safe `.jsonl` files discovered below one managed log root. */
async function pruneOneRoot(
  rootDirectory: string,
  options: Omit<PruneManagedLogsOptions, "rootDirectory" | "fallbackRootDirectory">,
): Promise<PruneManagedLogsResult> {
  const now = options.now ?? Date.now();
  const maxAgeMs = (options.maxAgeDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000;
  const maxFiles = options.maxFiles ?? DEFAULT_RETENTION_FILES;
  const maxBytes = options.maxBytes ?? DEFAULT_RETENTION_BYTES;
  const files = await listManagedFiles(rootDirectory);
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

/**
 * Applies the same retention rules to the primary root and, when provided, the
 * designed fallback root. Each root has its own file/byte budget.
 */
export async function pruneManagedLogs(
  options: PruneManagedLogsOptions,
): Promise<PruneManagedLogsResult> {
  const { rootDirectory, fallbackRootDirectory, ...rest } = options;
  const results = [await pruneOneRoot(rootDirectory, rest)];
  if (fallbackRootDirectory !== undefined) {
    results.push(await pruneOneRoot(fallbackRootDirectory, rest));
  }
  return results.reduce(
    (total, result) => ({
      deletedFiles: total.deletedFiles + result.deletedFiles,
      deletedBytes: total.deletedBytes + result.deletedBytes,
    }),
    { deletedFiles: 0, deletedBytes: 0 },
  );
}
