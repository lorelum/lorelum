import { expect, test } from "bun:test";

import {
  allowsLogLevel,
  createLogger,
  createTraceId,
  isTraceId,
  MemoryLogSink,
  serializeLogRecord,
  SinkLogEmitter,
  TraceDetailLogEmitter,
  withDiagnosticLevel,
} from "./index.js";

test("creates trace IDs and records ordinary context without an event registry", () => {
  const traceId = createTraceId();
  const sink = new MemoryLogSink();
  const logger = createLogger({ source: "backend.query", sinks: [sink] }).with({ traceId });

  logger.info("query.completed", { query: "find a practice", resultCount: 2 });

  expect(isTraceId(traceId)).toBe(true);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]).toMatchObject({
    source: "backend.query",
    message: "query.completed",
    traceId,
    context: { query: "find a practice", resultCount: 2 },
  });
});

test("filters known credentials but preserves ordinary local debugging content", () => {
  const sink = new MemoryLogSink();
  createLogger({ source: "hook.codex", level: "debug", sinks: [sink] }).debug("payload.received", {
    query: "use /absolute/path/model.gguf",
    authorization: "Bearer must-not-serialize",
    nested: { cookie: "must-not-serialize", nativeOutput: "raw native failure" },
  });

  const serialized = serializeLogRecord(sink.records[0]!);
  expect(serialized).toContain("/absolute/path/model.gguf");
  expect(serialized).toContain("raw native failure");
  expect(serialized).not.toContain("must-not-serialize");
});

test("serializes an Error and contains sink failure", () => {
  const sink = new MemoryLogSink();
  const logger = createLogger({ source: "cli", sinks: [sink] });
  logger.error("command.failed", { command: "query" }, new Error("unexpected failure"));
  expect(sink.records[0]?.error).toMatchObject({ name: "Error", message: "unexpected failure" });

  expect(() =>
    new SinkLogEmitter({
      write: () => {
        throw new Error("disk full");
      },
    }).emit({
      level: "error",
      message: "ignored",
    }),
  ).not.toThrow();
  expect(allowsLogLevel("warn", "info")).toBe(false);
  expect(allowsLogLevel("warn", "error")).toBe(true);
});

test("keeps request-scoped debug on its trace and anonymous shared lifecycle only", () => {
  const sink = new MemoryLogSink();
  const emitter = new TraceDetailLogEmitter("info", new SinkLogEmitter(sink));
  const traceA = "00000000-0000-4000-8000-000000000041" as never;
  const traceB = "00000000-0000-4000-8000-000000000042" as never;

  withDiagnosticLevel(emitter, "debug").emit({
    level: "info",
    source: "backend.query",
    message: "trace.preparation.accepted",
    traceId: traceA,
    preparationId: "preparation-shared",
  });
  emitter.emit({
    level: "debug",
    source: "backend.embedding",
    message: "native.poll",
    preparationId: "preparation-shared",
  });
  emitter.emit({
    level: "debug",
    source: "backend.query",
    message: "query.requested",
    traceId: traceB,
    preparationId: "preparation-shared",
    query: "another request must retain its own detail choice",
  });

  expect(sink.records.map((record) => record.message)).toEqual([
    "trace.preparation.accepted",
    "native.poll",
  ]);
  expect(JSON.stringify(sink.records)).not.toContain("another request");
});

test("captures logger context independently and normalizes each message context", () => {
  const sink = new MemoryLogSink();
  const context = { nested: { path: "/original" }, cookie: "must-not-serialize" };
  const logger = createLogger({ source: "cli", sinks: [sink], context });
  const childContext = { requestId: "request-original", nested: { path: "/child" } };
  const child = logger.with(childContext);
  context.nested.path = "/mutated";
  childContext.requestId = "request-mutated";
  childContext.nested.path = "/mutated-child";
  const messageContext = { nested: { path: "/message", token: "must-not-serialize" } };
  child.info("child-message", messageContext);
  messageContext.nested.path = "/mutated-message";
  child.info("child-captured");
  logger.info("parent-captured");

  expect(sink.records[0]).toMatchObject({
    requestId: "request-original",
    context: { nested: { path: "/message" } },
  });
  expect(sink.records[1]?.context?.nested).toEqual({ path: "/child" });
  expect(sink.records[2]?.context?.nested).toEqual({ path: "/original" });
  expect(JSON.stringify(sink.records)).not.toContain("must-not-serialize");
});
