import { defaultLogDirectory, loadLoggingSettings, resolveLorelumPaths } from "@lorelum/config";
import {
  createLogger,
  FanoutLogSink,
  FilteredLogEmitter,
  JsonlFileSink,
  pruneManagedLogs,
  SinkLogEmitter,
  type JsonlFileSinkFailure,
  type Logger as LocalLogger,
  type LogEmitter,
  type TraceId,
} from "@lorelum/log";
import { join, resolve } from "node:path";

import { CliStderrLogSink } from "../runtime/diagnostics.js";
import { Logger } from "../runtime/logger.js";

export interface ProcessLogRuntime {
  readonly logger: Logger;
  readonly log: LocalLogger;
  readonly diagnostics: LogEmitter;
  readonly logDirectory: string;
  flush(): Promise<void>;
}

function daySegment(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function logFile(root: string, source: "cli" | "hook", traceId: TraceId, host?: string): string {
  return source === "hook"
    ? join(root, "hooks", host ?? "unknown", daySegment(), `${traceId}.jsonl`)
    : join(root, "cli", daySegment(), `${traceId}.jsonl`);
}

async function configuredLevel(debug: boolean): Promise<"error" | "warn" | "info" | "debug"> {
  if (debug) return "debug";
  try {
    return (await loadLoggingSettings()).level;
  } catch {
    // A malformed optional logging section must not prevent normal CLI recovery.
    return "info";
  }
}

/**
 * One stderr line for a run whose diagnostic records were not persisted. It
 * states the known failure category only; business results, error codes, and
 * exit codes are untouched. A foreign-owned Lorelum root gets the focused
 * (non-recursive) ownership fix instead of a generic category.
 */
export function sinkFailureNotice(failure: JsonlFileSinkFailure, trustedDirectory: string): string {
  if (failure.category === "foreign-owner" && resolve(failure.path) === resolve(trustedDirectory)) {
    return `lorelum: diagnostic logs for this run were not saved: ${failure.path} is owned by another user. If lore ran with sudo, restore ownership with: sudo chown "$(id -u):$(id -g)" ${failure.path}`;
  }
  const detail = failure.detail === undefined ? "" : `: ${failure.detail}`;
  return `lorelum: diagnostic logs for this run were not saved (${failure.category} at ${failure.path}${detail})`;
}

/** Builds a persistent process-owned logger without changing stderr presentation semantics. */
export async function createProcessLogRuntime(
  stderr: { write(message: string): void },
  traceId: TraceId,
  options: {
    readonly debug: boolean;
    readonly source?: "cli" | "hook";
    readonly host?: string;
    readonly rootDirectory?: string;
    readonly persist?: boolean;
  } = {
    debug: false,
  },
): Promise<ProcessLogRuntime> {
  const source = options.source ?? "cli";
  const level = await configuredLevel(options.debug);
  const rootDirectory = options.rootDirectory ?? defaultLogDirectory();
  const trustedDirectory =
    options.rootDirectory === undefined ? resolveLorelumPaths().rootDirectory : rootDirectory;
  const fileSink =
    options.persist === false
      ? undefined
      : new JsonlFileSink(
          logFile(rootDirectory, source, traceId, options.host),
          rootDirectory,
          trustedDirectory,
        );
  const stderrLogger = new Logger(stderr);
  const diagnostics = new FilteredLogEmitter(
    level,
    new SinkLogEmitter(
      new FanoutLogSink([
        ...(fileSink === undefined ? [] : [fileSink]),
        new CliStderrLogSink(stderrLogger),
      ]),
    ),
  );
  const log = createLogger({
    source: source === "hook" ? `hook.${options.host ?? "unknown"}` : "cli",
    level,
    context: { traceId },
    sinks: fileSink === undefined ? [] : [fileSink],
  });
  if (fileSink !== undefined) void pruneManagedLogs({ rootDirectory }).catch(() => undefined);
  return {
    logger: stderrLogger,
    log,
    diagnostics,
    logDirectory: rootDirectory,
    flush: async () => {
      await fileSink?.close();
      const failure = fileSink?.failure;
      if (failure !== undefined) stderr.write(`${sinkFailureNotice(failure, trustedDirectory)}\n`);
    },
  };
}
