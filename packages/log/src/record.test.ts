import { expect, test } from "bun:test";

import { createLogRecord, DEFAULT_LOG_RECORD_BYTES, serializeLogRecord } from "./record";

test("serializes a native Error when an event supplies an explicit timestamp", () => {
  const record = createLogRecord({
    time: "2026-09-21T00:00:00.000Z",
    level: "error",
    source: "cli.query",
    message: "query.failed",
    error: new Error("preserve this stack"),
  });
  expect(record.error).toEqual(
    expect.objectContaining({ name: "Error", message: "preserve this stack" }),
  );
  expect(record.error?.stack).toContain("preserve this stack");
  expect(serializeLogRecord(record)).toContain("preserve this stack");
});

test("bounds producer context at the default transport limit before sink encoding", () => {
  const record = createLogRecord({
    level: "info",
    source: "backend",
    message: "large-context",
    requestId: "request-1",
    context: { output: "x".repeat(DEFAULT_LOG_RECORD_BYTES) },
  });
  expect(record).toMatchObject({
    message: "large-context",
    requestId: "request-1",
    truncated: true,
  });
  expect(record.context?.output).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(record), "utf8")).toBeLessThanOrEqual(
    DEFAULT_LOG_RECORD_BYTES,
  );
  expect(JSON.parse(serializeLogRecord(record))).toEqual(record);
});

test("honors explicit transport bounds for both events and existing records", () => {
  const input = {
    level: "info" as const,
    source: "backend",
    message: "bounded-context",
    context: { output: "x".repeat(1_024) },
  };
  const full = createLogRecord(input, { maxBytes: 2_048 });
  expect(full.context?.output).toBe(input.context.output);
  const bounded = createLogRecord(full, { maxBytes: 256 });
  expect(bounded.truncated).toBe(true);
  expect(bounded.context?.output).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThanOrEqual(256);
  const compact = createLogRecord({ ...input, message: "x".repeat(1_024) }, { maxBytes: 256 });
  expect(compact.message).toBe("Log record exceeded the transport limit.");
  expect(compact.truncated).toBe(true);
});
