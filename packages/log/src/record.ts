import {
  isLogLevel,
  pickCorrelation,
  sanitizeLogContext,
  type LogContext,
  type LogCorrelation,
  type LogLevel,
} from "./context.js";

export const DEFAULT_LOG_RECORD_BYTES = 65_536;

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface LogRecord extends LogCorrelation {
  readonly time: string;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly context?: LogContext;
  readonly error?: SerializedError;
  readonly truncated?: true;
}

/**
 * Permissive input intentionally supports arbitrary caller context. The
 * optional `event` and `component` fields make migration from the early
 * diagnostics prototype mechanical, not a lasting schema requirement.
 */
export interface LogEventInput extends LogContext {
  readonly time?: string;
  readonly level: LogLevel;
  readonly source?: string;
  readonly component?: string;
  readonly message?: string;
  readonly event?: string;
  readonly context?: LogContext;
  readonly error?: unknown;
  /**
   * Internal request-scoped collection override. It is consumed by a
   * correlation-aware emitter and deliberately never persisted as context.
   */
  readonly diagnosticLevel?: "debug";
}

const reservedKeys = new Set([
  "time",
  "level",
  "source",
  "component",
  "message",
  "event",
  "context",
  "error",
  "diagnosticLevel",
  "traceId",
  "requestId",
  "operationId",
  "preparationId",
  "nativeRunId",
  "invocationId",
]);

export function serializeError(error: unknown): SerializedError | undefined {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  if (error === undefined || error === null) return undefined;
  return { name: "Error", message: String(error) };
}

function isSerializedError(error: unknown): error is SerializedError {
  return (
    typeof error === "object" &&
    error !== null &&
    !Array.isArray(error) &&
    !(error instanceof Error) &&
    typeof (error as SerializedError).name === "string" &&
    typeof (error as SerializedError).message === "string" &&
    ((error as SerializedError).stack === undefined ||
      typeof (error as SerializedError).stack === "string")
  );
}

function isLogRecord(input: LogEventInput | LogRecord): input is LogRecord {
  return (
    "time" in input &&
    "source" in input &&
    "message" in input &&
    !("component" in input) &&
    !("event" in input) &&
    (!("error" in input) || input.error === undefined || isSerializedError(input.error))
  );
}

function contextFromInput(input: LogEventInput): LogContext | undefined {
  const context: Record<string, unknown> = { ...(input.context ?? {}) };
  for (const [key, value] of Object.entries(input)) {
    if (!reservedKeys.has(key)) context[key] = value;
  }
  return sanitizeLogContext(context);
}

function transportBound(record: LogRecord, maxBytes: number): LogRecord {
  if (Buffer.byteLength(JSON.stringify(record), "utf8") <= maxBytes) return record;
  const compact: LogRecord = {
    time: record.time,
    level: record.level,
    source: record.source,
    message: record.message,
    ...pickCorrelation({ ...record }),
    context: { notice: "Log record context exceeded the transport limit and was omitted." },
    truncated: true,
  };
  if (Buffer.byteLength(JSON.stringify(compact), "utf8") <= maxBytes) return compact;
  return {
    time: record.time,
    level: record.level,
    source: record.source,
    message: "Log record exceeded the transport limit.",
    truncated: true,
  };
}

export function createLogRecord(
  input: LogEventInput | LogRecord,
  options: {
    readonly source?: string;
    readonly context?: LogContext;
    readonly maxBytes?: number;
  } = {},
): LogRecord {
  if (isLogRecord(input)) {
    return transportBound(input as LogRecord, options.maxBytes ?? DEFAULT_LOG_RECORD_BYTES);
  }
  const eventInput = input as LogEventInput;
  if (!isLogLevel(eventInput.level)) throw new TypeError("Log level is invalid.");
  const mergedContext = {
    ...(options.context ?? {}),
    ...contextFromInput(eventInput),
  } as LogContext;
  const correlation = { ...pickCorrelation(mergedContext), ...pickCorrelation(eventInput) };
  const source = eventInput.source ?? options.source ?? eventInput.component ?? "lorelum";
  const message = eventInput.message ?? eventInput.event ?? "log";
  const error = serializeError(eventInput.error);
  const record: LogRecord = {
    time: eventInput.time ?? new Date().toISOString(),
    level: eventInput.level,
    source,
    message,
    ...correlation,
    ...(Object.keys(mergedContext).length === 0 ? {} : { context: mergedContext }),
    ...(error === undefined ? {} : { error }),
  };
  return transportBound(record, options.maxBytes ?? DEFAULT_LOG_RECORD_BYTES);
}

export function serializeLogRecord(record: LogRecord): string {
  return `${JSON.stringify(record)}\n`;
}
