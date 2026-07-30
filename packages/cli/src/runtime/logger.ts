import type { OutputWriter } from "../output/protocol.js";

export const logLevels = ["error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof logLevels)[number];

const priorities: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export class Logger {
  private level: LogLevel = "error";

  constructor(private readonly writer: OutputWriter) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  log(level: LogLevel, message: string): void {
    if (priorities[level] <= priorities[this.level]) {
      this.writer.write(`[${level}] ${message}\n`);
    }
  }
}
