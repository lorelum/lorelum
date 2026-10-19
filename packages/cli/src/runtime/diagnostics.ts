import { serializeLogRecord, type LogRecord, type LogSink } from "@lorelum/log";

import { Logger } from "./logger.js";

/** Keeps diagnostics on stderr through the existing level-aware logger facade. */
export class CliStderrLogSink implements LogSink {
  constructor(private readonly logger: Logger) {}

  write(record: LogRecord): void {
    if (!this.logger.isEnabled(record.level)) return;
    this.logger.log(record.level, serializeLogRecord(record).trimEnd());
  }
}
