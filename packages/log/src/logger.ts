import {
  allowsLogLevel,
  sanitizeLogContext,
  type LogContext,
  type LogCorrelation,
  type LogLevel,
} from "./context.js";
import { createLogRecord } from "./record.js";
import type { LogSink } from "./sink.js";

export interface Logger {
  readonly source: string;
  readonly level: LogLevel;
  with(context: LogContext & LogCorrelation): Logger;
  debug(message: string, context?: LogContext, error?: unknown): void;
  info(message: string, context?: LogContext, error?: unknown): void;
  warn(message: string, context?: LogContext, error?: unknown): void;
  error(message: string, context?: LogContext, error?: unknown): void;
}

export interface CreateLoggerOptions {
  readonly source: string;
  readonly level?: LogLevel;
  readonly context?: LogContext & LogCorrelation;
  readonly sinks?: readonly LogSink[];
}

class LocalLogger implements Logger {
  readonly level: LogLevel;
  readonly source: string;

  constructor(
    options: CreateLoggerOptions,
    private readonly context: LogContext,
    private readonly sinks: readonly LogSink[],
  ) {
    this.source = options.source;
    this.level = options.level ?? "info";
  }

  with(context: LogContext & LogCorrelation): Logger {
    return new LocalLogger(
      { source: this.source, level: this.level },
      { ...this.context, ...sanitizeLogContext(context) },
      this.sinks,
    );
  }

  debug(message: string, context?: LogContext, error?: unknown): void {
    this.write("debug", message, context, error);
  }

  info(message: string, context?: LogContext, error?: unknown): void {
    this.write("info", message, context, error);
  }

  warn(message: string, context?: LogContext, error?: unknown): void {
    this.write("warn", message, context, error);
  }

  error(message: string, context?: LogContext, error?: unknown): void {
    this.write("error", message, context, error);
  }

  private write(
    level: LogLevel,
    message: string,
    context: LogContext | undefined,
    error: unknown,
  ): void {
    if (!allowsLogLevel(this.level, level)) return;
    const record = createLogRecord({
      level,
      source: this.source,
      message,
      context: { ...this.context, ...context },
      error,
    });
    for (const sink of this.sinks) {
      try {
        const result = sink.write(record);
        if (result instanceof Promise) void result.catch(() => undefined);
      } catch {
        // A single sink is best-effort once the logger has been constructed.
      }
    }
  }
}

export function createLogger(options: CreateLoggerOptions): Logger {
  return new LocalLogger(options, sanitizeLogContext(options.context) ?? {}, options.sinks ?? []);
}
