import {
  allowsLogLevel,
  collectTraceLogs,
  deriveTraceEvidenceState,
  type LogLevel,
  type LogRecord,
  type ManagedLogRoot,
  type TraceEvidenceState,
  type TraceId,
} from "@lorelum/log";
import { defaultDiagnosticsFallbackDirectory, defaultLogDirectory } from "@lorelum/config";

export type FeedbackLogLevel = Extract<LogLevel, "info" | "debug">;

export interface TraceLogSelection {
  readonly traceId: TraceId;
  readonly level: FeedbackLogLevel;
  readonly records: readonly LogRecord[];
  /** Aligned with `records`; which designed root held each one. */
  readonly recordLocations: readonly ManagedLogRoot[];
  readonly missingEvidence: readonly string[];
  /** The one trace-bound evidence state shared with `lore logs`. */
  readonly evidence: TraceEvidenceState;
}

export interface ReadTraceLogsOptions {
  /** Test-only managed log root override; production uses `~/.lorelum/logs`. */
  readonly logDirectory?: string;
  readonly fallbackLogDirectory?: string;
}

/** Reads only already-written records for one trace; it never starts a runtime or scans elsewhere. */
export async function readTraceLogs(
  traceId: TraceId,
  level: FeedbackLogLevel,
  options: ReadTraceLogsOptions = {},
): Promise<TraceLogSelection> {
  const rootDirectory = options.logDirectory ?? defaultLogDirectory();
  // Explicit test overrides stay isolated from the real home fallback.
  const fallbackRootDirectory =
    options.fallbackLogDirectory ??
    (options.logDirectory === undefined ? defaultDiagnosticsFallbackDirectory() : undefined);
  const collection = await collectTraceLogs({
    rootDirectory,
    ...(fallbackRootDirectory === undefined ? {} : { fallbackRootDirectory }),
    traceId,
    limit: 1_000,
  });
  const evidence = deriveTraceEvidenceState(collection);
  const located = [
    ...collection.directRecords.map((record, index) => ({
      record,
      root: collection.directLocations[index] ?? ("primary" as const),
    })),
    ...collection.sharedRecords.map((record, index) => ({
      record,
      root: collection.sharedLocations[index] ?? ("primary" as const),
    })),
  ]
    .filter((entry) => allowsLogLevel(level, entry.record.level))
    .sort((left, right) => left.record.time.localeCompare(right.record.time));
  const records = located.map((entry) => entry.record);
  const missingEvidence = [
    ...evidence.missingEvidence,
    ...(level === "debug" && !records.some((record) => record.level === "debug")
      ? ["debug-records-not-found"]
      : []),
  ];
  return {
    traceId,
    level,
    records,
    recordLocations: located.map((entry) => entry.root),
    missingEvidence: [...new Set(missingEvidence)],
    evidence,
  };
}
