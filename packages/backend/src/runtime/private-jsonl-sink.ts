import { constants } from "node:fs";
import { open, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  serializeLogRecord,
  createLogRecord,
  type LogEventInput,
  type LogRecord,
  type LogSink,
} from "@lorelum/log";

import { BackendError } from "../protocol/errors";
import { assertPrivateFile, checkDirectory, hasCode } from "./runtime-state";

/**
 * The backend sink deliberately owns only a small, private set of files.  The
 * defaults preserve the old lifecycle log's 64 KiB current file plus one
 * rotated file, while keeping the retention policy explicit for tests and
 * future event-volume tuning.
 */
export const DEFAULT_PRIVATE_JSONL_FILE_BYTES = 65_536;
export const DEFAULT_PRIVATE_JSONL_FILE_COUNT = 2;

export interface PrivateJsonlSinkOptions {
  readonly directory: string;
  readonly fileName?: string;
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
}

type SinkState = "new" | "ready" | "disabled";

function invalidTarget(cause?: unknown): BackendError {
  return new BackendError("backend.state-invalid", cause === undefined ? undefined : { cause });
}

function isBackendStateInvalid(error: unknown): boolean {
  return error instanceof BackendError && error.code === "backend.state-invalid";
}

/**
 * The managed-file name grammar this sink family owns: a bare `stem` is the
 * current file and `stem.N` (numeric N ≥ 0, no leading `-`) is a rotation.
 * Everything else is foreign. Shared with the daemon's self-heal so a naming
 * change can never make preflight and healing disagree (the F1 class of gap).
 */
export function managedRotationSuffix(name: string, stem: string): number | undefined {
  const prefix = `${stem}.`;
  if (!name.startsWith(prefix)) return undefined;
  const suffix = name.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const value = Number(suffix);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * A best-effort private JSONL sink for already-declared, JSON-safe events.
 *
 * `preflight()` is the security boundary: an unsafe directory or existing
 * sink file rejects with `backend.state-invalid`.  Once preflight succeeds,
 * ordinary write/rotation failures disable this sink and are intentionally
 * swallowed so diagnostics cannot change the backend business result.
 */
export class PrivateJsonlSink implements LogSink {
  private readonly directory: string;
  private readonly fileName: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly path: string;
  private state: SinkState = "new";
  private preflightPromise: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: PrivateJsonlSinkOptions) {
    if (!Number.isSafeInteger(options.maxFileBytes ?? DEFAULT_PRIVATE_JSONL_FILE_BYTES)) {
      throw new RangeError("maxFileBytes must be a safe integer");
    }
    if ((options.maxFileBytes ?? DEFAULT_PRIVATE_JSONL_FILE_BYTES) < 1) {
      throw new RangeError("maxFileBytes must be positive");
    }
    if (!Number.isSafeInteger(options.maxFiles ?? DEFAULT_PRIVATE_JSONL_FILE_COUNT)) {
      throw new RangeError("maxFiles must be a safe integer");
    }
    if ((options.maxFiles ?? DEFAULT_PRIVATE_JSONL_FILE_COUNT) < 1) {
      throw new RangeError("maxFiles must be positive");
    }
    this.directory = options.directory;
    this.fileName = options.fileName ?? "backend.log";
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_PRIVATE_JSONL_FILE_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_PRIVATE_JSONL_FILE_COUNT;
    this.path = join(this.directory, this.fileName);
  }

  get disabled(): boolean {
    return this.state === "disabled";
  }

  get currentPath(): string {
    return this.path;
  }

  /** Perform the security and bounded-retention checks before the first write. */
  async preflight(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "disabled") return;
    this.preflightPromise ??= this.runPreflight();
    await this.preflightPromise;
  }

  /**
   * Queue writes so concurrent lifecycle events each occupy one complete JSON
   * line and rotation cannot interleave with another writer.
   */
  write(record: LogEventInput | LogRecord): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.preflight();
      if (this.state === "disabled") return;
      try {
        const serialized = serializeLogRecord(createLogRecord(record));
        const bytes = Buffer.byteLength(serialized, "utf8");
        // Declared events are expected to be bounded by their owner.  Refuse
        // an oversized line rather than violating the sink's hard byte bound.
        if (bytes > this.maxFileBytes) {
          this.state = "disabled";
          return;
        }
        await this.writeSerialized(serialized, bytes);
      } catch (error) {
        // A replacement/symlink/hardlink after preflight remains a security
        // failure.  Never downgrade it to the best-effort disabled path.
        if (isBackendStateInvalid(error)) throw error;
        this.state = "disabled";
      }
    });
    // Keep the queue usable after a contained I/O failure while preserving an
    // unsafe-target rejection for the caller that encountered it.
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    await this.queue;
  }

  private async runPreflight(): Promise<void> {
    try {
      await checkDirectory(this.directory, true);
    } catch (error) {
      if (isBackendStateInvalid(error)) throw error;
      throw invalidTarget(error);
    }
    const stem = basename(this.path);
    const entries = await readdir(this.directory).catch((error: unknown) => {
      throw isBackendStateInvalid(error) ? error : invalidTarget(error);
    });
    const managed = new Map<number, string>();
    for (const entry of entries) {
      if (entry === stem) continue;
      const suffix = managedRotationSuffix(entry, stem);
      if (suffix !== undefined) managed.set(suffix, join(this.directory, entry));
    }

    // Validate every existing managed file, including stale rotations.  Safe
    // stale files are removed so files left by an older retention setting do
    // not defeat the current hard total-file bound.
    for (const [suffix, path] of managed) {
      if (!(await assertPrivateFile(path))) continue;
      const info = await stat(path);
      if (info.size > this.maxFileBytes) throw invalidTarget();
      if (suffix < 1 || suffix >= this.maxFiles) await unlink(path);
    }
    if (await assertPrivateFile(this.path)) {
      const info = await stat(this.path);
      if (info.size > this.maxFileBytes) throw invalidTarget();
    }

    // A directory entry can be replaced between readdir and this check; the
    // explicit assert keeps the current target's security contract clear.
    await assertPrivateFile(this.path);
    this.state = "ready";
  }

  private rotatedPath(suffix: number): string {
    return `${this.path}.${suffix}`;
  }

  private async writeSerialized(serialized: string, bytes: number): Promise<void> {
    const currentExists = await assertPrivateFile(this.path);
    let currentBytes = 0;
    if (currentExists) {
      currentBytes = (await stat(this.path)).size;
    }
    if (currentBytes + bytes > this.maxFileBytes) {
      await this.rotate();
      currentBytes = 0;
    }
    if (currentBytes + bytes > this.maxFileBytes) {
      // This can only occur when rotation could not produce an empty current
      // file; treat it as a contained sink failure rather than overrun bound.
      throw new Error("private diagnostic sink cannot fit event");
    }

    const flags =
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
    const file = await open(this.path, flags, 0o600);
    try {
      await file.writeFile(serialized, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async rotate(): Promise<void> {
    // Validate the current target before moving it.  A symlink/hardlink is an
    // unsafe target, not a recoverable I/O failure.
    await assertPrivateFile(this.path);
    for (let suffix = this.maxFiles - 1; suffix >= 1; suffix -= 1) {
      const target = this.rotatedPath(suffix);
      if (await assertPrivateFile(target)) {
        await unlink(target);
      }
      const source = suffix === 1 ? this.path : this.rotatedPath(suffix - 1);
      if (!(await assertPrivateFile(source))) continue;
      await rename(source, target);
    }
    if (this.maxFiles === 1) {
      await unlink(this.path).catch((error: unknown) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
    }
  }
}

export async function createPrivateJsonlSink(
  options: PrivateJsonlSinkOptions,
): Promise<PrivateJsonlSink> {
  const sink = new PrivateJsonlSink(options);
  await sink.preflight();
  return sink;
}
