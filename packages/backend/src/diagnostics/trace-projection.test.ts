import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogRecord } from "@lorelum/log";

import { readTraceDiagnosticFacts } from "./trace-projection";

test("projects only summary facts for the selected trace and drops generic raw context", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-trace-projection-"));
  const traceA = "00000000-0000-4000-8000-000000000011" as never;
  const traceB = "00000000-0000-4000-8000-000000000012" as never;
  try {
    const directory = join(root, "backend");
    await mkdir(directory, { recursive: true });
    const records = [
      createLogRecord({
        level: "error",
        source: "backend.embedding",
        message: "native.exited-before-ready",
        traceId: traceA,
        nativeRunId: "native-a",
        readiness: "failed",
        exitCode: 0,
        stdoutBytes: 0,
        stderrBytes: 0,
        query: "must not be included in summary",
        nativeOutput: "must not be included in summary",
      }),
      createLogRecord({
        level: "error",
        source: "backend.query",
        message: "backend.request.failed",
        traceId: traceB,
        query: "other trace must not be included",
      }),
    ];
    await writeFile(
      join(directory, "current.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    const projection = await readTraceDiagnosticFacts(traceA, { logDirectory: root });
    expect(projection.missingEvidence).toEqual([]);
    expect(projection.facts).toEqual([
      expect.objectContaining({
        event: "native.exited-before-ready",
        traceId: traceA,
        nativeRunId: "native-a",
        readiness: "failed",
        exitCode: 0,
        stdoutBytes: 0,
        stderrBytes: 0,
      }),
    ]);
    expect(JSON.stringify(projection)).not.toContain("must not be included");
    expect(JSON.stringify(projection)).not.toContain("other trace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns missing evidence without starting a runtime", async () => {
  const traceId = "00000000-0000-4000-8000-000000000013" as never;
  const root = join(tmpdir(), `lorelum-missing-${crypto.randomUUID()}`);
  const projection = await readTraceDiagnosticFacts(traceId, { logDirectory: root });
  expect(projection.facts).toEqual([]);
  // The shared evidence state supplies the vocabulary: an empty readable
  // store is "no matching records", never an invented write failure.
  expect(projection.missingEvidence).toEqual(["log-files-missing", "no-matching-records"]);
  expect(projection.evidence.status).toBe("no-matching-records");
});

test("follows shared lifecycle facts but never another trace's context", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-trace-relations-"));
  const traceA = "00000000-0000-4000-8000-000000000014" as never;
  const traceB = "00000000-0000-4000-8000-000000000015" as never;
  try {
    const directory = join(root, "backend");
    await mkdir(directory, { recursive: true });
    const records = [
      createLogRecord({
        level: "info",
        source: "backend.query",
        message: "trace.preparation.accepted",
        traceId: traceA,
        requestId: "request-a",
        preparationId: "preparation-shared",
      }),
      createLogRecord({
        level: "error",
        source: "backend.embedding",
        message: "native.exited-before-ready",
        preparationId: "preparation-shared",
        nativeRunId: "native-shared",
        readiness: "failed",
        exitCode: 0,
        stdoutBytes: 0,
        stderrBytes: 0,
        nativeOutput: "shared native output must not escape the fact projection",
      }),
      createLogRecord({
        level: "error",
        source: "backend.query",
        message: "backend.request.failed",
        traceId: traceB,
        preparationId: "preparation-shared",
        query: "other trace must not enter the selected draft",
      }),
    ];
    await writeFile(
      join(directory, "current.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    const projection = await readTraceDiagnosticFacts(traceA, { logDirectory: root });
    expect(projection.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "trace.preparation.accepted",
          preparationId: "preparation-shared",
        }),
        expect.objectContaining({
          event: "native.exited-before-ready",
          nativeRunId: "native-shared",
          exitCode: 0,
        }),
      ]),
    );
    expect(JSON.stringify(projection)).not.toContain("other trace");
    expect(JSON.stringify(projection)).not.toContain("shared native output");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
