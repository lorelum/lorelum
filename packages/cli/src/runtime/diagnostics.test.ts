import { createLogRecord, createTraceId } from "@lorelum/log";
import { expect, test } from "bun:test";

import { CliStderrLogSink } from "./diagnostics.js";
import { Logger } from "./logger.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("serializes generic log records through the existing stderr logger", () => {
  const writer = new MemoryWriter();
  const logger = new Logger(writer);
  logger.setLevel("info");
  new CliStderrLogSink(logger).write(
    createLogRecord({
      time: "2026-09-18T00:00:00.000Z",
      level: "info",
      source: "cli",
      message: "command.started",
      traceId: createTraceId(),
      invocationId: "invocation-1",
    }),
  );

  expect(writer.value).toStartWith("[info] {");
  expect(writer.value).toContain('"message":"command.started"');
  expect(writer.value.endsWith("\n")).toBe(true);
});

test("keeps disabled diagnostics off stderr and preserves enabled failure evidence", () => {
  const writer = new MemoryWriter();
  const logger = new Logger(writer);
  const sink = new CliStderrLogSink(logger);
  sink.write(createLogRecord({ level: "debug", message: "hidden diagnostic" }));
  sink.write(createLogRecord({ level: "info", message: "hidden lifecycle" }));
  expect(writer.value).toBe("");

  sink.write(
    createLogRecord({
      level: "error",
      message: "command.failed",
      error: new Error("failure detail"),
      context: { authorization: "Bearer must-not-serialize", path: "/local/model.gguf" },
    }),
  );
  expect(writer.value).toStartWith("[error] {");
  expect(writer.value).toContain('"message":"command.failed"');
  expect(writer.value).toContain("failure detail");
  expect(writer.value).toContain('"stack":');
  expect(writer.value).toContain("/local/model.gguf");
  expect(writer.value).not.toContain("must-not-serialize");
});
