import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogRecord } from "@lorelum/log";

import { snapshotCommandDefinitions } from "../registry";
import { run } from "../main";
import { publishFeedbackArtifact } from "./artifacts";
import { createFeedbackCommand } from "./command";
import type { FeedbackReport } from "./types";

class MemoryWriter {
  value = "";
  write(message: string) {
    this.value += message;
  }
}

test("trace-rooted draft writes local artifacts while stdout contains only the envelope", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-command-")));
  const traceId = "00000000-0000-4000-8000-000000000022" as never;
  const stdout = new MemoryWriter();
  try {
    const command = createFeedbackCommand({
      defaultOutputDirectory: () => parent,
      readInput: async () => {
        throw new Error("trace draft must not read an input file");
      },
      publish: publishFeedbackArtifact,
      readTraceDiagnostics: async () => ({
        traceId,
        facts: [
          {
            event: "backend.request.started",
            time: "2026-09-18T00:00:00.000Z",
            traceId,
            requestId: "request-1",
            route: "query",
            query: "raw query stays local",
          },
        ],
        missingEvidence: [],
        evidence: {
          traceId,
          status: "available",
          roots: ["primary"],
          missingEvidence: [],
        },
      }),
      readTraceLogs: async (requestedTraceId, level) => {
        expect(requestedTraceId).toBe(traceId);
        expect(level).toBe("info");
        return {
          traceId,
          level,
          records: [
            createLogRecord({
              level: "info",
              source: "cli.query",
              message: "query.requested",
              traceId,
              query: "raw query stays local",
            }),
            createLogRecord({
              level: "error",
              source: "cli.query",
              message: "query.failed",
              traceId,
              error: new Error("trace stack stays local"),
            }),
          ],
          recordLocations: ["primary", "primary"],
          evidence: {
            traceId,
            status: "available",
            roots: ["primary"],
            missingEvidence: [],
          },
          missingEvidence: [],
        };
      },
    });
    expect(
      await run(["--json", "feedback", "draft", "--trace-id", traceId, "--kind", "bug"], {
        registry: snapshotCommandDefinitions([command]),
        stdout,
      }),
    ).toBe(0);
    expect(stdout.value.trim().split("\n")).toHaveLength(1);
    expect(stdout.value).not.toContain("raw query stays local");
    const response = JSON.parse(stdout.value) as {
      data: { reportPath: string; markdownPath: string; externalReview: { required: boolean } };
    };
    expect(response).toMatchObject({
      command: "feedback.draft",
      ok: true,
      data: { state: "draft" },
    });
    expect(response.data.externalReview.required).toBe(false);
    const report = await readFile(response.data.reportPath, "utf8");
    const markdown = await readFile(response.data.markdownPath, "utf8");
    expect(report).toContain("raw query stays local");
    expect(report).toContain("trace stack stays local");
    expect(markdown).toContain("raw query stays local");
    expect(markdown).toContain("Local draft only");
    const saved = JSON.parse(report) as FeedbackReport;
    const detailed = saved.evidence.find((item) => item.type === "detailed-logs");
    expect(detailed).toEqual(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            error: expect.objectContaining({
              stack: expect.stringContaining("trace stack stays local"),
            }),
          }),
        ]),
      }),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("debug trace logs are added after an explicit request", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-detail-")));
  const traceId = "00000000-0000-4000-8000-000000000024" as never;
  try {
    const command = createFeedbackCommand({
      defaultOutputDirectory: () => parent,
      readInput: async () => "",
      publish: publishFeedbackArtifact,
      readTraceDiagnostics: async () => ({
        traceId,
        facts: [],
        missingEvidence: [],
        evidence: {
          traceId,
          status: "no-matching-records",
          roots: [],
          missingEvidence: ["no-matching-records"],
        },
      }),
      readTraceLogs: async () => ({
        traceId,
        level: "debug",
        records: [
          createLogRecord({
            level: "debug",
            source: "cli.query",
            message: "query.requested",
            traceId,
            query: "selected detailed query",
          }),
        ],
        recordLocations: ["primary"],
        missingEvidence: [],
        evidence: {
          traceId,
          status: "available",
          roots: ["primary"],
          missingEvidence: [],
        },
      }),
    });
    const stdout = new MemoryWriter();
    expect(
      await run(
        [
          "--json",
          "feedback",
          "draft",
          "--trace-id",
          traceId,
          "--kind",
          "bug",
          "--include-logs",
          "debug",
        ],
        {
          registry: snapshotCommandDefinitions([command]),
          stdout,
        },
      ),
    ).toBe(0);
    const response = JSON.parse(stdout.value) as {
      data: { reportPath: string; externalReview: { required: boolean } };
    };
    expect(response.data.externalReview.required).toBe(false);
    expect(await readFile(response.data.reportPath, "utf8")).toContain("selected detailed query");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("explicit info keeps the default trace evidence selection", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-info-")));
  const traceId = "00000000-0000-4000-8000-000000000026" as never;
  const requestedLevels: string[] = [];
  try {
    const command = createFeedbackCommand({
      defaultOutputDirectory: () => parent,
      readInput: async () => "",
      publish: publishFeedbackArtifact,
      readTraceDiagnostics: async () => ({
        traceId,
        facts: [],
        missingEvidence: [],
        evidence: {
          traceId,
          status: "no-matching-records",
          roots: [],
          missingEvidence: ["no-matching-records"],
        },
      }),
      readTraceLogs: async (_traceId, level) => {
        requestedLevels.push(level);
        return {
          traceId,
          level,
          records: [
            createLogRecord({
              level: "info",
              source: "cli.query",
              message: "query.requested",
              traceId,
              query: "same default evidence",
            }),
          ],
          recordLocations: ["primary"],
          evidence: {
            traceId,
            status: "available",
            roots: ["primary"],
            missingEvidence: [],
          },
          missingEvidence: [],
        };
      },
    });
    const createDraft = async (draftArguments: readonly string[]) => {
      const stdout = new MemoryWriter();
      expect(
        await run(["--json", "feedback", "draft", ...draftArguments], {
          registry: snapshotCommandDefinitions([command]),
          stdout,
        }),
      ).toBe(0);
      const response = JSON.parse(stdout.value) as { data: { reportPath: string } };
      return readFile(response.data.reportPath, "utf8");
    };
    const [defaultReport, explicitInfoReport] = await Promise.all([
      createDraft(["--trace-id", traceId, "--kind", "bug"]),
      createDraft(["--trace-id", traceId, "--kind", "bug", "--include-logs", "info"]),
    ]);
    expect(defaultReport).toContain("same default evidence");
    expect(explicitInfoReport).toContain("same default evidence");
    expect(requestedLevels).toEqual(["info", "info"]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("invalid feedback arguments publish no local artifact", async () => {
  let published = 0;
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const command = createFeedbackCommand({
    defaultOutputDirectory: () => "/unused",
    readInput: async () => "{}",
    readTraceDiagnostics: async () => ({
      traceId: "00000000-0000-4000-8000-000000000023" as never,
      facts: [],
      missingEvidence: [],
      evidence: {
        traceId: "00000000-0000-4000-8000-000000000023" as never,
        status: "no-matching-records",
        roots: [],
        missingEvidence: ["no-matching-records"],
      },
    }),
    publish: async () => {
      published++;
      return { reportPath: "/unused/report.json", markdownPath: "/unused/report.md" };
    },
  });
  expect(
    await run(["--json", "feedback", "draft", "--trace-id", "not-a-trace", "--kind", "bug"], {
      registry: snapshotCommandDefinitions([command]),
      stdout,
      stderr,
    }),
  ).toBe(2);
  expect(published).toBe(0);
  expect(stderr.value).toBe("");
  expect(JSON.parse(stdout.value)).toMatchObject({ ok: false, error: { code: "usage.invalid" } });
});

test("advanced input remains out of argv and stdout while selected local content enters the artifact", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-input-")));
  const stdout = new MemoryWriter();
  try {
    const command = createFeedbackCommand({
      defaultOutputDirectory: () => parent,
      readTraceDiagnostics: async () => {
        throw new Error("input draft must not read trace diagnostics");
      },
      readInput: async (source) => {
        expect(source).toBe("manual.json");
        return JSON.stringify({
          schemaVersion: 2,
          kind: "improvement",
          summary: "A useful gap",
          observed: "The current guidance omitted a decision boundary.",
          selected: { query: "manual local query", conversationExcerpt: "user context" },
        });
      },
      publish: publishFeedbackArtifact,
    });
    expect(
      await run(["--json", "feedback", "draft", "--input", "manual.json", "--output", parent], {
        registry: snapshotCommandDefinitions([command]),
        stdout,
      }),
    ).toBe(0);
    expect(stdout.value).not.toContain("manual local query");
    const response = JSON.parse(stdout.value) as { data: { reportPath: string } };
    expect(await readFile(response.data.reportPath, "utf8")).toContain("manual local query");
    expect(await readFile(response.data.reportPath, "utf8")).toContain("conversation-excerpt");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
