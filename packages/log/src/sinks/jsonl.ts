import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";
/* eslint-disable no-await-in-loop -- Each path component must be checked and created in order. */

import {
  createLogRecord,
  serializeLogRecord,
  type LogEventInput,
  type LogRecord,
} from "../record.js";
import type { LogSink } from "../sink.js";
import {
  hasCode,
  inspectAndTightenExistingFile,
  inspectAndTightenHandle,
  ManagedLogLocationError,
  walkManagedLocation,
  type ManagedLogLocationFailure,
  type ManagedRepairFact,
} from "./safety.js";

/** What a sink's managed location ended up doing, read after `close()`. */
export interface JsonlFileSinkOutcome {
  readonly status: "new" | "ready" | "unavailable" | "write-failed";
  readonly repairs: readonly ManagedRepairFact[];
  readonly failure?: ManagedLogLocationFailure;
}

/** A best-effort append-only JSONL sink for one process-owned segment file. */
export class JsonlFileSink implements LogSink {
  private disabled = false;
  private queue: Promise<void> = Promise.resolve();
  private preflightPromise: Promise<void> | undefined;
  private readonly repairs: ManagedRepairFact[] = [];
  private failure: ManagedLogLocationFailure | undefined;
  private status: JsonlFileSinkOutcome["status"] = "new";

  constructor(
    readonly path: string,
    private readonly rootDirectory = dirname(path),
    private readonly trustedDirectory = dirname(rootDirectory),
  ) {}

  get outcome(): JsonlFileSinkOutcome {
    return {
      status: this.status,
      repairs: this.repairs,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    };
  }

  /** Safe paths are established once; a later replacement disables this sink. */
  async preflight(): Promise<void> {
    this.preflightPromise ??= this.prepareLocation();
    await this.preflightPromise;
  }

  /**
   * Verifies (and where safely possible tightens) every existing segment from
   * the trusted directory down to the segment file, creating missing segments
   * with the intended private mode. Unsafe segments reject with a typed
   * ManagedLogLocationError instead of being touched. Repairs are pushed into
   * `this.repairs` as the walk proceeds, so a failure partway through still
   * reports the tightenings that happened before it.
   */
  private async prepareLocation(): Promise<void> {
    await walkManagedLocation(
      this.trustedDirectory,
      dirname(this.path),
      {
        createMissing: true,
      },
      this.repairs,
    );
    const inspected = await inspectAndTightenExistingFile(this.path);
    if (inspected?.verdict.verdict === "unsafe") {
      throw new ManagedLogLocationError(inspected.verdict.reason, this.path);
    }
    if (inspected?.repair) this.repairs.push(inspected.repair);
  }

  write(record: LogRecord | LogEventInput): Promise<void> {
    if (this.disabled) return Promise.resolve();
    const operation = this.queue.then(async () => {
      if (this.disabled) return;
      try {
        await this.preflight();
        // Re-verify on every write so a replaced managed directory cannot be
        // followed after a successful startup, matching the pre-repair checks.
        await this.prepareLocation();
        const existed = await lstat(this.path).then(
          () => true,
          (error: unknown) => {
            if (hasCode(error, "ENOENT")) return false;
            throw error;
          },
        );
        const file = await open(
          this.path,
          constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        try {
          // A segment this process created is forced to the intended mode
          // regardless of umask; an existing one is verified and tightened on
          // the same descriptor the record is written through.
          if (!existed) await file.chmod(0o600);
          const inspected = await inspectAndTightenHandle(file, this.path, "file");
          if (inspected.verdict.verdict === "unsafe") {
            throw new ManagedLogLocationError(inspected.verdict.reason, this.path);
          }
          if (inspected.repair) this.repairs.push(inspected.repair);
          await file.writeFile(serializeLogRecord(createLogRecord(record)), "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        this.status = "ready";
      } catch (error) {
        this.disabled = true;
        if (error instanceof ManagedLogLocationError) {
          this.failure = { kind: "location-unavailable", reason: error.reason, path: error.path };
          this.status = "unavailable";
        } else if (this.status === "ready") {
          this.failure = { kind: "write-failed", path: this.path, error: String(error) };
          this.status = "write-failed";
        } else {
          this.failure = { kind: "location-error", path: this.path, error: String(error) };
          this.status = "unavailable";
        }
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
