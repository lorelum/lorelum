import { defaultLogDirectory, resolveLorelumPaths, resolveLoggingSettings } from "@lorelum/config";
import {
  createLogger,
  FanoutLogSink,
  FilteredLogEmitter,
  JsonlFileSink,
  pruneManagedLogs,
  SinkLogEmitter,
  type Logger as LocalLogger,
  type LogEmitter,
  type TraceId,
} from "@lorelum/log";
import { join } from "node:path";

import { CliStderrLogSink } from "../runtime/diagnostics.js";
import { Logger } from "../runtime/logger.js";
import { createInvocationNotice, type InvocationNotice } from "../output/notices.js";

export interface ProcessLogRuntime {
  readonly logger: Logger;
  readonly log: LocalLogger;
  readonly diagnostics: LogEmitter;
  readonly logDirectory: string;
  /** Non-fatal runtime facts for this invocation, e.g. a rejected logging.level. */
  readonly notices: readonly InvocationNotice[];
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

interface LoggingFallbackFact {
  readonly received: string;
  readonly allowedValues: readonly string[];
  readonly source: string;
}

/**
 * Resolves the effective persistent level. A value-level rejection keeps the
 * rejected fact and falls back to `info` (or stays `debug` under the one-shot
 * override); a document-level failure stays silently fail-open because no
 * user-expressed value can be attributed to it.
 */
async function resolveEffectiveLogging(debug: boolean): Promise<{
  readonly level: "error" | "warn" | "info" | "debug";
  readonly fallback?: LoggingFallbackFact;
}> {
  let resolved: Awaited<ReturnType<typeof resolveLoggingSettings>>;
  try {
    resolved = await resolveLoggingSettings();
  } catch {
    // A malformed optional logging document must not prevent normal CLI recovery.
    return { level: debug ? "debug" : "info" };
  }
  if (resolved.status === "valid") return { level: debug ? "debug" : resolved.level };
  return {
    level: debug ? "debug" : "info",
    fallback: {
      received: resolved.received,
      allowedValues: [...resolved.allowedValues],
      source: resolved.source,
    },
  };
}

function singleLine(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ");
}

/** One level-independent stderr line; it must not depend on `--log-level`. */
function fallbackWarningLine(notice: InvocationNotice, debug: boolean): string {
  const allowed = notice.expected?.kind === "enum" ? notice.expected.values.join(", ") : undefined;
  const allowedSegment = allowed === undefined ? "" : ` (allowed: ${allowed})`;
  const overrideSegment = debug ? " (--debug overrides persistent config)" : "";
  const received = singleLine(notice.received ?? "");
  const effective = singleLine(notice.effective ?? "info");
  return `warning: ${notice.subject} "${received}" is invalid${allowedSegment}; using "${effective}" for this invocation${overrideSegment}.\n`;
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
  const effective = await resolveEffectiveLogging(options.debug);
  const level = effective.level;
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
  const notices: InvocationNotice[] = [];
  if (effective.fallback !== undefined) {
    const notice = createInvocationNotice({
      kind: "configuration",
      subject: "logging.level",
      reason: "invalid-value",
      received: effective.fallback.received,
      expected: { kind: "enum", values: effective.fallback.allowedValues },
      effective: level,
      source: effective.fallback.source,
    });
    notices.push(notice);
    stderr.write(fallbackWarningLine(notice, options.debug));
    diagnostics.emit({
      level: "warn",
      component: source === "hook" ? `hook.${options.host ?? "unknown"}` : "cli",
      event: "logging.level-fallback",
      traceId,
      context: {
        setting: notice.subject,
        ...(notice.received === undefined ? {} : { received: notice.received }),
        effective: notice.effective,
        ...(notice.source === undefined ? {} : { source: notice.source }),
      },
    });
  }
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
    notices: Object.freeze(notices),
    flush: async () => fileSink?.close(),
  };
}
