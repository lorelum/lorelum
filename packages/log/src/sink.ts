import {
  allowsLogLevel,
  pickCorrelation,
  sanitizeLogContext,
  type LogCorrelation,
  type LogLevel,
} from "./context.js";
import { createLogRecord, type LogEventInput, type LogRecord } from "./record.js";

export interface LogSink {
  write(record: LogRecord): void | Promise<void>;
}

export interface LogEmitter {
  emit(input: LogEventInput): void;
}

export const noopEmitter: LogEmitter = Object.freeze({ emit: () => undefined });

export class MemoryLogSink implements LogSink {
  readonly records: LogRecord[] = [];

  write(record: LogRecord): void {
    this.records.push(record);
  }
}

/** Adapts an arbitrary record input to a sink without allowing sink failures to affect work. */
export class SinkLogEmitter implements LogEmitter {
  constructor(private readonly sink: LogSink) {}

  emit(input: LogEventInput): void {
    try {
      const result = this.sink.write(createLogRecord(input));
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Logging must never change the caller's business result.
    }
  }
}

export class FilteredLogEmitter implements LogEmitter {
  constructor(
    private readonly minimumLevel: LogLevel,
    private readonly delegate: LogEmitter,
  ) {}

  emit(input: LogEventInput): void {
    if (allowsLogLevel(this.minimumLevel, input.level)) this.delegate.emit(input);
  }
}

const correlationFields = ["requestId", "operationId", "preparationId", "nativeRunId"] as const;

function correlationKeys(record: LogCorrelation): readonly string[] {
  return correlationFields.flatMap((field) => {
    const value = record[field];
    return value === undefined ? [] : [`${field}:${value}`];
  });
}

/**
 * Selects a request's already-authenticated debug override without globally
 * enabling debug for an otherwise info-level Backend daemon. Relation keys are
 * remembered so later preparation/native lifecycle records retain the same
 * collection level, while a record from another trace is never made detailed
 * merely because it exists in the same process.
 */
export class TraceDetailLogEmitter implements LogEmitter {
  private readonly debugTraces = new Set<string>();
  private readonly debugRelations = new Set<string>();

  constructor(
    private readonly minimumLevel: LogLevel,
    private readonly delegate: LogEmitter,
  ) {}

  emit(input: LogEventInput): void {
    const record = {
      ...pickCorrelation(sanitizeLogContext({ ...pickCorrelation(input.context ?? {}) }) ?? {}),
      ...pickCorrelation(input),
    };
    const directDebug =
      record.traceId !== undefined &&
      (input.diagnosticLevel === "debug" || this.debugTraces.has(record.traceId));
    const relatedDebug =
      record.traceId === undefined &&
      correlationKeys(record).some((key) => this.debugRelations.has(key));

    if (record.traceId !== undefined && (input.diagnosticLevel === "debug" || directDebug)) {
      this.debugTraces.add(record.traceId);
    }
    if (directDebug || relatedDebug) {
      for (const key of correlationKeys(record)) this.debugRelations.add(key);
    }
    if (allowsLogLevel(this.minimumLevel, input.level) || directDebug || relatedDebug) {
      this.delegate.emit(input);
    }
  }
}

/** Adds an internal collection override without making it part of a log record. */
export function withDiagnosticLevel(
  delegate: LogEmitter,
  diagnosticLevel: "debug" | undefined,
): LogEmitter {
  if (diagnosticLevel === undefined) return delegate;
  return Object.freeze({
    emit(input: LogEventInput): void {
      delegate.emit({ ...input, diagnosticLevel });
    },
  });
}

export class FanoutLogSink implements LogSink {
  constructor(private readonly sinks: readonly LogSink[]) {}

  write(record: LogRecord): void {
    for (const sink of this.sinks) {
      try {
        const result = sink.write(record);
        if (result instanceof Promise) void result.catch(() => undefined);
      } catch {
        // Each destination is independently best-effort.
      }
    }
  }
}
