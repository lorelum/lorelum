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

test("collects a trace whose records were diverted to the fallback root", async () => {
  const primary = await mkdtemp(join(tmpdir(), "lorelum-trace-primary-"));
  const fallback = await mkdtemp(join(tmpdir(), "lorelum-trace-fallback-"));
  const traceA = "00000000-0000-4000-8000-000000000041" as never;
  try {
    await mkdir(join(fallback, "cli"), { recursive: true });
    const diverted = createLogRecord({
      level: "info",
      source: "cli.query",
      message: "completed",
      traceId: traceA,
    });
    await writeFile(join(fallback, "cli", "segment.jsonl"), `${JSON.stringify(diverted)}\n`);
    const result = await collectTraceLogs({
      rootDirectory: primary,
      fallbackRootDirectory: fallback,
      traceId: traceA,
    });
    expect(result.directRecords).toEqual([diverted]);
    expect(result.directLocations).toEqual(["fallback"]);
    expect(result.missing).toEqual([]);
  } finally {
    await rm(primary, { recursive: true, force: true });
    await rm(fallback, { recursive: true, force: true });
  }
});
