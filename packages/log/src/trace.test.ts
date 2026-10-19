import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogRecord } from "./record.js";
import { collectTraceLogs } from "./trace.js";

test("collects exact-trace records and anonymous shared lifecycle relations only", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-trace-collection-"));
  const traceA = "00000000-0000-4000-8000-000000000031" as never;
  const traceB = "00000000-0000-4000-8000-000000000032" as never;
  try {
    const directory = join(root, "backend");
    await mkdir(directory, { recursive: true });
    const records = [
      createLogRecord({
        level: "info",
        source: "backend.query",
        message: "trace.operation.accepted",
        traceId: traceA,
        operationId: "operation-shared",
      }),
      createLogRecord({
        level: "debug",
        source: "backend.index",
        message: "backend.operation.progress",
        operationId: "operation-shared",
      }),
      createLogRecord({
        level: "debug",
        source: "backend.query",
        message: "query.requested",
        traceId: traceB,
        operationId: "operation-shared",
        query: "sibling content",
      }),
    ];
    await writeFile(
      join(directory, "current.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    const result = await collectTraceLogs({ rootDirectory: root, traceId: traceA });
    expect(result.directRecords).toHaveLength(1);
    expect(result.sharedRecords).toEqual([
      expect.objectContaining({
        message: "backend.operation.progress",
        operationId: "operation-shared",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("sibling content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps older direct records outside a crowded global window and follows anonymous relations", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-trace-window-"));
  const traceA = "00000000-0000-4000-8000-000000000031" as never;
  const traceB = "00000000-0000-4000-8000-000000000032" as never;
  try {
    const records = [
      createLogRecord({
        time: "2026-09-18T00:00:02.000Z",
        level: "info",
        message: "direct-later",
        traceId: traceA,
        operationId: "operation-shared",
      }),
      createLogRecord({
        time: "2026-09-18T00:00:01.000Z",
        level: "info",
        message: "direct-earlier",
        traceId: traceA,
      }),
      createLogRecord({
        level: "info",
        message: "unrelated",
        traceId: traceB,
      }),
      createLogRecord({
        level: "info",
        message: "native-progress",
        nativeRunId: "native-shared",
      }),
      createLogRecord({
        level: "info",
        message: "operation-native-link",
        operationId: "operation-shared",
        nativeRunId: "native-shared",
      }),
      createLogRecord({
        level: "info",
        message: "other-trace",
        traceId: traceB,
        operationId: "operation-shared",
      }),
    ];
    await writeFile(
      join(root, "current.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );

    const result = await collectTraceLogs({ rootDirectory: root, traceId: traceA, limit: 3 });
    expect(result.directRecords.map((record) => record.message)).toEqual([
      "direct-earlier",
      "direct-later",
    ]);
    expect(result.sharedRecords.map((record) => record.message).sort()).toEqual([
      "native-progress",
      "operation-native-link",
    ]);
    expect(result.truncated).toBe(true);
    expect(result.missing).toEqual(["trace-log-collection-truncated"]);
    expect(JSON.stringify(result)).not.toContain("other-trace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounds the direct window while preserving corruption and partial-tail diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-trace-corrupt-"));
  const traceId = "00000000-0000-4000-8000-000000000031" as never;
  try {
    const records = [0, 1, 2].map((sequence) =>
      createLogRecord({
        time: `2026-09-18T00:00:0${sequence}.000Z`,
        level: "info",
        message: `direct-${sequence}`,
        traceId,
      }),
    );
    await writeFile(
      join(root, "current.jsonl.1"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\ninvalid\n{}\n{"partial":`,
    );

    const result = await collectTraceLogs({ rootDirectory: root, traceId, limit: 2 });
    expect(result.directRecords.map((record) => record.message)).toEqual(["direct-1", "direct-2"]);
    expect(result.sharedRecords).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.missing).toEqual([
      "log-file-corrupt:current.jsonl.1",
      "log-record-invalid:current.jsonl.1",
      "trace-log-collection-truncated",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
