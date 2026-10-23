import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogRecord } from "@lorelum/log";

import { run } from "../main.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

test("views one trace through the public logs command and prunes only managed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-cli-logs-"));
  try {
    const traceId = "00000000-0000-4000-8000-000000000301" as never;
    const directory = join(root, "cli", "2026-09-18");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "fixture.jsonl"),
      `${JSON.stringify(
        createLogRecord({
          level: "debug",
          source: "cli.query",
          message: "query.requested",
          traceId,
          query: "trace-specific query",
        }),
      )}\n`,
    );
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    expect(
      await run(["--json", "logs", "--trace-id", traceId], { stdout, stderr, logDirectory: root }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({
      command: "logs",
      ok: true,
      data: { records: [{ traceId, message: "query.requested" }] },
    });

    const prune = new MemoryWriter();
    expect(await run(["--json", "logs", "prune"], { stdout: prune, logDirectory: root })).toBe(0);
    expect(JSON.parse(prune.value)).toMatchObject({
      command: "logs",
      ok: true,
      data: { deletedFiles: 0, deletedBytes: 0 },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trace reads include shared preparation logs without crossing into sibling traces", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-cli-shared-logs-"));
  try {
    const traceId = "00000000-0000-4000-8000-000000000311" as never;
    const joiningTraceId = "00000000-0000-4000-8000-000000000313" as never;
    const siblingTraceId = "00000000-0000-4000-8000-000000000312" as never;
    const preparationId = "prep-311";
    const backendDirectory = join(root, "backend");
    const cliDirectory = join(root, "cli", "2026-10-23");
    await mkdir(backendDirectory, { recursive: true });
    await mkdir(cliDirectory, { recursive: true });

    const direct = createLogRecord({
      time: "2026-10-23T10:00:00.000Z",
      level: "info",
      source: "backend.request",
      message: "trace.preparation.accepted",
      traceId,
      requestId: "request-311",
      preparationId,
    });
    const joining = createLogRecord({
      time: "2026-10-23T10:00:00.500Z",
      level: "info",
      source: "backend.request",
      message: "trace.preparation.accepted",
      traceId: joiningTraceId,
      requestId: "request-313",
      preparationId,
      query: "joining trace private context",
    });
    const preparationDebug = createLogRecord({
      time: "2026-10-23T10:00:01.000Z",
      level: "debug",
      source: "backend",
      message: "backend.preparation.resource-check",
      preparationId,
    });
    const nativeDebugBefore = createLogRecord({
      time: "2026-10-23T10:00:02.000Z",
      level: "debug",
      source: "backend.native",
      message: "native.startup-check",
      preparationId,
      nativeRunId: "native-311",
    });
    const nativeDebugAfter = createLogRecord({
      time: "2026-10-23T10:00:03.000Z",
      level: "debug",
      source: "backend.native",
      message: "native.readiness-check",
      preparationId,
      nativeRunId: "native-311",
    });
    const sibling = createLogRecord({
      time: "2026-10-23T10:00:04.000Z",
      level: "debug",
      source: "backend",
      message: "sibling.private-query-context",
      traceId: siblingTraceId,
      requestId: "request-312",
      preparationId,
      query: "must not cross traces",
    });
    const unrelated = createLogRecord({
      time: "2026-10-23T10:00:05.000Z",
      level: "debug",
      source: "backend",
      message: "unrelated.preparation-detail",
      preparationId: "prep-unrelated",
    });
    await writeFile(
      join(cliDirectory, "trace.jsonl"),
      `${JSON.stringify(direct)}\n${JSON.stringify(joining)}\n`,
    );
    await writeFile(
      join(backendDirectory, "current.jsonl"),
      [
        JSON.stringify(preparationDebug),
        JSON.stringify(nativeDebugBefore),
        "not valid JSON",
        JSON.stringify(nativeDebugAfter),
        JSON.stringify(sibling),
        JSON.stringify(unrelated),
      ].join("\n") + "\n",
    );

    const stdout = new MemoryWriter();
    expect(
      await run(["--json", "logs", "--trace-id", traceId], {
        stdout,
        logDirectory: root,
      }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response.data.records.map((record: { message: string }) => record.message)).toEqual(
      expect.arrayContaining([
        "trace.preparation.accepted",
        "backend.preparation.resource-check",
        "native.startup-check",
        "native.readiness-check",
      ]),
    );
    const messages = response.data.records.map((record: { message: string }) => record.message);
    expect(messages).not.toContain("sibling.private-query-context");
    expect(messages).not.toContain("unrelated.preparation-detail");
    expect(response.data.records).not.toContainEqual(
      expect.objectContaining({ traceId: joiningTraceId, query: "joining trace private context" }),
    );
    expect(
      response.data.records
        .filter((record: { traceId?: string }) => record.traceId !== undefined)
        .every((record: { traceId?: string }) => record.traceId === traceId),
    ).toBe(true);
    expect(response.data.missingEvidence).toContain("log-file-corrupt:backend/current.jsonl");

    const joinedTrace = new MemoryWriter();
    expect(
      await run(["--json", "logs", "--trace-id", joiningTraceId], {
        stdout: joinedTrace,
        logDirectory: root,
      }),
    ).toBe(0);
    const joinedResponse = JSON.parse(joinedTrace.value);
    expect(
      joinedResponse.data.records.map((record: { message: string }) => record.message),
    ).toContain("backend.preparation.resource-check");
    expect(joinedResponse.data.records).not.toContainEqual(
      expect.objectContaining({ traceId, requestId: "request-311" }),
    );
    expect(
      joinedResponse.data.records
        .filter((record: { traceId?: string }) => record.traceId !== undefined)
        .every((record: { traceId?: string }) => record.traceId === joiningTraceId),
    ).toBe(true);

    const filtered = new MemoryWriter();
    expect(
      await run(
        [
          "--json",
          "logs",
          "--trace-id",
          traceId,
          "--source",
          "backend.native",
          "--level",
          "debug",
          "--limit",
          "1",
        ],
        { stdout: filtered, logDirectory: root },
      ),
    ).toBe(0);
    const filteredResponse = JSON.parse(filtered.value);
    expect(filteredResponse.data.records).toEqual([
      expect.objectContaining({ message: "native.readiness-check", preparationId }),
    ]);
    expect(filteredResponse.data.truncated).toBe(true);
    expect(filteredResponse.data.missingEvidence).toContain(
      "log-file-corrupt:backend/current.jsonl",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("debug is a per-invocation persistent collection override", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lorelum-cli-debug-parent-"));
  await chmod(parent, 0o777);
  const root = await mkdtemp(join(parent, "logs-"));
  try {
    const stdout = new MemoryWriter();
    const traceId = "00000000-0000-4000-8000-000000000302" as never;
    expect(await run(["--debug"], { stdout, logDirectory: root, traceId })).toBe(0);
    const logs = new MemoryWriter();
    expect(
      await run(["--json", "logs", "--trace-id", traceId, "--level", "debug"], {
        stdout: logs,
        logDirectory: root,
      }),
    ).toBe(0);
    expect(JSON.parse(logs.value).data.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: "command.debug-enabled" })]),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
