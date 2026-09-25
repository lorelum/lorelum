import { defaultDiagnosticsFallbackDirectory, defaultLogDirectory } from "@lorelum/config";
import {
  collectTraceLogs,
  deriveTraceEvidenceState,
  type LogContext,
  type LogRecord,
  type TraceEvidenceState,
  type TraceId,
} from "@lorelum/log";

export interface TraceDiagnosticFact {
  readonly event: string;
  readonly time: string;
  readonly traceId?: TraceId;
  readonly requestId?: string;
  readonly operationId?: string;
  readonly preparationId?: string;
  readonly nativeRunId?: string;
  readonly route?: string;
  readonly method?: "GET" | "POST";
  readonly status?: number;
  readonly buildIdentity?: string;
  readonly readiness?: "pending" | "ready" | "failed";
  readonly exitCode?: number;
  readonly signal?: string;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly durationMs?: number;
  readonly count?: number;
  readonly code?: string;
}

export interface TraceDiagnosticProjection {
  readonly traceId: TraceId;
  readonly facts: readonly TraceDiagnosticFact[];
  readonly missingEvidence: readonly string[];
  /** The one trace-bound evidence state shared with `lore logs` and feedback. */
  readonly evidence: TraceEvidenceState;
}

export interface ReadTraceDiagnosticFactsOptions {
  /** Test-only managed log root override; production uses `~/.lorelum/logs`. */
  readonly logDirectory?: string;
  /** @deprecated Test compatibility alias for the managed log root. */
  readonly runtimeDirectory?: string;
  readonly fallbackLogDirectory?: string;
}

function text(context: LogContext | undefined, key: string): string | undefined {
  const value = context?.[key];
  return typeof value === "string" ? value : undefined;
}

function number(context: LogContext | undefined, key: string): number | undefined {
  const value = context?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optional<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function factFromRecord(record: LogRecord): TraceDiagnosticFact {
  const context = record.context;
  const route = text(context, "route");
  const method = text(context, "method");
  const readiness = text(context, "readiness");
  return {
    event: record.message,
    time: record.time,
    ...optional(record.traceId, "traceId"),
    ...optional(record.requestId, "requestId"),
    ...optional(record.operationId, "operationId"),
    ...optional(record.preparationId, "preparationId"),
    ...optional(record.nativeRunId, "nativeRunId"),
    ...optional(route, "route"),
    ...(method === "GET" || method === "POST" ? { method } : {}),
    ...optional(number(context, "status"), "status"),
    ...optional(text(context, "buildIdentity"), "buildIdentity"),
    ...(readiness === "pending" || readiness === "ready" || readiness === "failed"
      ? { readiness }
      : {}),
    ...optional(number(context, "exitCode"), "exitCode"),
    ...optional(text(context, "signal"), "signal"),
    ...optional(number(context, "stdoutBytes"), "stdoutBytes"),
    ...optional(number(context, "stderrBytes"), "stderrBytes"),
    ...optional(number(context, "durationMs"), "durationMs"),
    ...optional(number(context, "count"), "count"),
    ...optional(text(context, "code"), "code"),
  };
}

/**
 * A narrow feedback-default projection. It reads only managed same-trace
 * records and intentionally drops generic context such as query/raw output.
 */
export async function readTraceDiagnosticFacts(
  traceId: TraceId,
  options: ReadTraceDiagnosticFactsOptions = {},
): Promise<TraceDiagnosticProjection> {
  const rootDirectory = options.logDirectory ?? options.runtimeDirectory ?? defaultLogDirectory();
  // Explicit test overrides stay isolated from the real home fallback.
  const fallbackRootDirectory =
    options.fallbackLogDirectory ??
    (options.logDirectory === undefined && options.runtimeDirectory === undefined
      ? defaultDiagnosticsFallbackDirectory()
      : undefined);
  const collection = await collectTraceLogs({
    rootDirectory,
    ...(fallbackRootDirectory === undefined ? {} : { fallbackRootDirectory }),
    traceId,
    limit: 1_000,
  });
  const evidence = deriveTraceEvidenceState(collection);
  const direct = collection.directRecords.filter(
    (record) =>
      record.level === "error" ||
      record.level === "warn" ||
      /^(?:native\.|backend\.|trace\.|cli\.command\.)/.test(record.message),
  );
  const shared = collection.sharedRecords.filter((record) =>
    /^(?:native\.|backend\.(?:preparation|operation)\.)/.test(record.message),
  );
  const facts = [...direct, ...shared]
    .sort((left, right) => left.time.localeCompare(right.time))
    .map(factFromRecord);
  return {
    traceId,
    facts,
    // The evidence state is the single source: an empty fact list without a
    // persisted "not persisted" outcome stays "no matching records", never an
    // invented write-failure explanation.
    missingEvidence: facts.length === 0 ? evidence.missingEvidence : collection.missing,
    evidence,
  };
}
