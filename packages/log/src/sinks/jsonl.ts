import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";

import {
  createLogRecord,
  serializeLogRecord,
  type LogEventInput,
  type LogRecord,
} from "../record.js";
import type { LogSink } from "../sink.js";
import {
  hasCode,
  inspectAndTightenHandle,
  ManagedLogLocationError,
  openFailureReason,
  walkManagedLocation,
  type UnsafeTargetReason,
} from "./safety.js";

const APPEND_FLAGS = constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);

export type JsonlFileSinkFailureCategory = UnsafeTargetReason | "write-failed";

/** Why one invocation's diagnostic records were not persisted, for the current-run notice. */
export interface JsonlFileSinkFailure {
  readonly category: JsonlFileSinkFailureCategory;
  readonly path: string;
  readonly detail?: string;
}

function failureFrom(error: unknown, path: string): JsonlFileSinkFailure {
  if (error instanceof ManagedLogLocationError) {
    return { category: error.reason, path: error.path };
  }
  const detail =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : String(error);
  return { category: "write-failed", path, detail };
}

/** A best-effort append-only JSONL sink for one process-owned segment file. */
export class JsonlFileSink implements LogSink {
  private disabled = false;
  private queue: Promise<void> = Promise.resolve();
  private preflightPromise: Promise<void> | undefined;
  private sinkFailure: JsonlFileSinkFailure | undefined;

  constructor(
    readonly path: string,
    private readonly rootDirectory = dirname(path),
    private readonly trustedDirectory = dirname(rootDirectory),
  ) {}

  /** The first failure that disabled this sink, read after `close()` for the invocation notice. */
  get failure(): JsonlFileSinkFailure | undefined {
    return this.sinkFailure;
  }

  /** Safe paths are established once; a later replacement disables this sink. */
  async preflight(): Promise<void> {
    this.preflightPromise ??= this.prepareLocation();
    await this.preflightPromise;
  }

  /**
   * Structurally gates the trusted directory (never tightened) and verifies —
   * or safely tightens — every managed segment below it down to the segment
   * directory, creating missing segments private. Unsafe segments reject with
   * a typed ManagedLogLocationError instead of being touched.
   */
  private async prepareLocation(): Promise<void> {
    await walkManagedLocation(this.trustedDirectory, dirname(this.path));
  }

  write(record: LogRecord | LogEventInput): Promise<void> {
    if (this.disabled) return Promise.resolve();
    const operation = this.queue.then(async () => {
      if (this.disabled) return;
      try {
        await this.preflight();
        // Re-verify on every write so a replaced managed segment cannot be
        // followed after a successful startup.
        await this.prepareLocation();
        await this.appendRecord(record);
      } catch (error) {
        this.disabled = true;
        // Keep the first failure: with one managed location it is the root
        // cause of this run's missing evidence.
        this.sinkFailure ??= failureFrom(error, this.path);
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async appendRecord(record: LogRecord | LogEventInput): Promise<void> {
    // One lstat keeps symlink refusal platform-independent: Windows has no
    // O_NOFOLLOW, so the open below would follow a reparse point there.
    const existing = await lstat(this.path).catch((error: unknown) => {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    });
    if (existing !== undefined && existing.isSymbolicLink()) {
      throw new ManagedLogLocationError("symlink", this.path);
    }
    let file = await open(this.path, APPEND_FLAGS).catch(async (error: unknown) => {
      if (!hasCode(error, "ENOENT")) {
        throw new ManagedLogLocationError(await openFailureReason(this.path, error), this.path);
      }
      return undefined;
    });
    let created = false;
    if (file === undefined) {
      file = await open(this.path, APPEND_FLAGS | constants.O_CREAT, 0o600);
      created = true;
    }
    try {
      // A segment this process created is set to the intended mode regardless
      // of umask; an existing one is verified and tightened on the same
      // descriptor the record is written through.
      if (created) await file.chmod(0o600);
      const verdict = await inspectAndTightenHandle(file, this.path, "file");
      if (verdict.verdict === "unsafe") {
        throw new ManagedLogLocationError(verdict.reason, this.path);
      }
      await file.writeFile(serializeLogRecord(createLogRecord(record)), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
