import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientVsServerYaml } from "./decide/fixtures.js";
import { run } from "./main.js";
import { protocolResponseSchema, type JsonSchema } from "./output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "./output/protocol-schema.test-helper.js";
import { describeCommand } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

async function withPackDirectory(
  decisionsYaml: string,
  runWithDirectory: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-decide-"));
  try {
    await writeFile(join(directory, "decisions.yaml"), decisionsYaml);
    await runWithDirectory(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function decisionResultSchema(): JsonSchema {
  const description = describeCommand("decide") as { resultSchema?: JsonSchema } | undefined;
  if (description?.resultSchema === undefined) {
    throw new Error("Missing result schema for decide");
  }
  return description.resultSchema;
}

test("exposes decide through capability discovery", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run(["describe", "decide"], { stderr, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "decide",
      usage: "decide <pack-path>",
      positionals: [{ name: "pack-path", required: true }],
      options: [
        { name: "-h, --help", required: false },
        { name: "--log-level <level>", required: false },
        { name: "--decision <id>", required: true },
        { name: "--context <json>", required: true },
      ],
      errorCodes: [
        "usage.invalid",
        "runtime.unexpected",
        "pack.path_invalid",
        "pack.unreadable",
        "pack.parse_error",
        "decide.unknown_decision",
        "decide.invalid_condition",
        "decide.duplicate_decision",
        "decide.cycle",
      ],
      exitCodes: [0, 2],
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  const discoverySchema = (describeCommand("describe") as { resultSchema?: JsonSchema } | undefined)
    ?.resultSchema;
  if (discoverySchema === undefined) throw new Error("Missing describe result schema");
  expect(validateJsonSchema(response.data, discoverySchema)).toEqual([]);
});

test("evaluates a matching decision through the CLI protocol", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  await withPackDirectory(clientVsServerYaml, async (directory) => {
    expect(
      await run(
        [
          "decide",
          directory,
          "--decision",
          "state.client-vs-server",
          "--context",
          '{"state":{"client":"heavy"}}',
        ],
        { stderr, stdout },
      ),
    ).toBe(0);
  });
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      status: "matched",
      entryDecision: "state.client-vs-server",
      recommendations: [{ practiceId: "react.state.redux", reasons: ["Redux scales"] }],
      trace: [
        {
          decisionId: "state.client-vs-server",
          matchedWhen: 'state.client == "heavy"',
          nextDecision: null,
          question: "How much client state?",
        },
      ],
    },
  });
  expect(stderr.value).toBe("");
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, decisionResultSchema())).toEqual([]);
});

test("returns no_match when no branch matches the provided context", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  await withPackDirectory(clientVsServerYaml, async (directory) => {
    expect(
      await run(
        [
          "decide",
          directory,
          "--decision",
          "state.client-vs-server",
          "--context",
          '{"state":{"client":"light"}}',
        ],
        { stderr, stdout },
      ),
    ).toBe(0);
  });
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      status: "no_match",
      entryDecision: "state.client-vs-server",
      noMatchReason: "no branch matched the provided context",
      recommendations: [],
      trace: [{ decisionId: "state.client-vs-server", matchedWhen: null, nextDecision: null }],
    },
  });
  expect(validateJsonSchema(response.data, decisionResultSchema())).toEqual([]);
});

test("validates a chained match with non-null next edges against the result schema", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const chainedYaml = [
    "- id: state.entry",
    "  question: Start?",
    "  branches:",
    "    - when: 'state.client == \"heavy\"'",
    "      recommend: [react.state.redux]",
    "      reason: Redux scales",
    "      next: state.fallback",
    "- id: state.fallback",
    "  question: Fallback?",
    "  branches:",
    "    - when: 'state.mode == \"offline\"'",
    "      recommend: []",
    "      reason: Nothing extra",
    "",
  ].join("\n");

  await withPackDirectory(chainedYaml, async (directory) => {
    expect(
      await run(
        [
          "decide",
          directory,
          "--decision",
          "state.entry",
          "--context",
          '{"state":{"client":"heavy","mode":"offline"}}',
        ],
        { stderr, stdout },
      ),
    ).toBe(0);
  });
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      status: "matched",
      entryDecision: "state.entry",
      recommendations: [{ practiceId: "react.state.redux", reasons: ["Redux scales"] }],
      trace: [
        { decisionId: "state.entry", nextDecision: "state.fallback" },
        { decisionId: "state.fallback", nextDecision: null },
      ],
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, decisionResultSchema())).toEqual([]);
});

test("validates a matched result with empty recommendations against the result schema", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const emptyRecommendYaml = [
    "- id: state.entry",
    "  question: What now?",
    "  branches:",
    "    - when: 'enabled'",
    "      recommend: []",
    "      reason: No practice applies",
    "",
  ].join("\n");

  await withPackDirectory(emptyRecommendYaml, async (directory) => {
    expect(
      await run(
        ["decide", directory, "--decision", "state.entry", "--context", '{"enabled":true}'],
        { stderr, stdout },
      ),
    ).toBe(0);
  });
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "decide",
    ok: true,
    data: { status: "matched", entryDecision: "state.entry", recommendations: [] },
  });
  expect(validateJsonSchema(response.data, decisionResultSchema())).toEqual([]);
});

test("treats an empty decisions document as no_match", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  await withPackDirectory("", async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr,
        stdout,
      }),
    ).toBe(0);
  });
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      noMatchReason: "pack has no decisions",
      recommendations: [],
      status: "no_match",
    },
  });
});

test("maps invalid pack paths and missing documents to pack errors", async () => {
  const missingDirectory = new MemoryWriter();
  const missingDirectoryStderr = new MemoryWriter();
  const absentPath = join(tmpdir(), "lorelum-decide-missing-pack");

  expect(
    await run(["decide", absentPath, "--decision", "state.entry", "--context", "{}"], {
      stderr: missingDirectoryStderr,
      stdout: missingDirectory,
    }),
  ).toBe(2);
  expect(JSON.parse(missingDirectory.value)).toMatchObject({
    command: "decide",
    error: { code: "pack.path_invalid" },
    ok: false,
  });

  const directory = await mkdtemp(join(tmpdir(), "lorelum-decide-"));
  try {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr,
        stdout,
      }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "decide",
      error: { code: "pack.unreadable" },
      ok: false,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("maps malformed and non-list decisions documents to pack.parse_error", async () => {
  const malformed = new MemoryWriter();
  const malformedStderr = new MemoryWriter();
  await withPackDirectory("- id: [unclosed", async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr: malformedStderr,
        stdout: malformed,
      }),
    ).toBe(2);
  });
  expect(JSON.parse(malformed.value)).toMatchObject({
    command: "decide",
    error: { code: "pack.parse_error" },
    ok: false,
  });

  const notAList = new MemoryWriter();
  const notAListStderr = new MemoryWriter();
  await withPackDirectory("id: state.entry", async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr: notAListStderr,
        stdout: notAList,
      }),
    ).toBe(2);
  });
  expect(JSON.parse(notAList.value)).toMatchObject({
    command: "decide",
    error: {
      code: "pack.parse_error",
      message: "The decisions document is not a list of decision nodes.",
    },
    ok: false,
  });
});

test("rejects invalid context and missing required options as usage errors", async () => {
  await withPackDirectory(clientVsServerYaml, async (directory) => {
    const badContext = new MemoryWriter();
    const badContextStderr = new MemoryWriter();
    expect(
      await run(
        ["decide", directory, "--decision", "state.client-vs-server", "--context", "not-json"],
        { stderr: badContextStderr, stdout: badContext },
      ),
    ).toBe(2);
    expect(JSON.parse(badContext.value)).toMatchObject({
      command: "decide",
      error: { code: "usage.invalid" },
      ok: false,
    });

    const missingContext = new MemoryWriter();
    const missingContextStderr = new MemoryWriter();
    expect(
      await run(["decide", directory, "--decision", "state.client-vs-server"], {
        stderr: missingContextStderr,
        stdout: missingContext,
      }),
    ).toBe(2);
    expect(JSON.parse(missingContext.value)).toMatchObject({
      command: "decide",
      error: { code: "usage.invalid" },
      ok: false,
    });

    const missingDecision = new MemoryWriter();
    const missingDecisionStderr = new MemoryWriter();
    expect(
      await run(["decide", directory, "--context", "{}"], {
        stderr: missingDecisionStderr,
        stdout: missingDecision,
      }),
    ).toBe(2);
    expect(JSON.parse(missingDecision.value)).toMatchObject({
      command: "decide",
      error: { code: "usage.invalid" },
      ok: false,
    });
  });
});

test("maps evaluator failures to their declared protocol errors", async () => {
  const unknown = new MemoryWriter();
  const unknownStderr = new MemoryWriter();
  await withPackDirectory(clientVsServerYaml, async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.missing", "--context", "{}"], {
        stderr: unknownStderr,
        stdout: unknown,
      }),
    ).toBe(2);
  });
  expect(JSON.parse(unknown.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.unknown_decision" },
    ok: false,
  });

  const duplicate = new MemoryWriter();
  const duplicateStderr = new MemoryWriter();
  const duplicateYaml = [
    "- id: state.entry",
    "  question: What now?",
    "  branches: []",
    "- id: state.entry",
    "  question: Ambiguous duplicate?",
    "  branches: []",
    "",
  ].join("\n");
  await withPackDirectory(duplicateYaml, async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr: duplicateStderr,
        stdout: duplicate,
      }),
    ).toBe(2);
  });
  expect(JSON.parse(duplicate.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.duplicate_decision" },
    ok: false,
  });

  const cycle = new MemoryWriter();
  const cycleStderr = new MemoryWriter();
  const cycleYaml = [
    "- id: state.entry",
    "  question: Start?",
    "  branches:",
    "    - when: 'enabled'",
    "      recommend: []",
    "      reason: Loop",
    "      next: state.entry",
    "",
  ].join("\n");
  await withPackDirectory(cycleYaml, async (directory) => {
    expect(
      await run(
        ["decide", directory, "--decision", "state.entry", "--context", '{"enabled":true}'],
        { stderr: cycleStderr, stdout: cycle },
      ),
    ).toBe(2);
  });
  expect(JSON.parse(cycle.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.cycle" },
    ok: false,
  });

  const invalidCondition = new MemoryWriter();
  const invalidConditionStderr = new MemoryWriter();
  const invalidConditionYaml = [
    "- id: state.entry",
    "  question: What now?",
    "  branches:",
    "    - when: 'state.client = \"heavy\"'",
    "      recommend: []",
    "      reason: Invalid",
    "",
  ].join("\n");
  await withPackDirectory(invalidConditionYaml, async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr: invalidConditionStderr,
        stdout: invalidCondition,
      }),
    ).toBe(2);
  });
  expect(JSON.parse(invalidCondition.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.invalid_condition" },
    ok: false,
  });
});

test("rejects an oversized decisions document as pack.unreadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-decide-"));
  try {
    const oversized = "# " + "a".repeat(300 * 1024) + "\n";
    await writeFile(join(directory, "decisions.yaml"), oversized);
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr,
        stdout,
      }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "decide",
      error: { code: "pack.unreadable" },
      ok: false,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects a flat condition beyond the binary operator limit", async () => {
  const condition = Array.from({ length: 1026 }, () => "true").join(" && ");
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const boundedYaml = [
    "- id: state.entry",
    "  question: Bound?",
    "  branches:",
    "    - when: '" + condition + "'",
    "      recommend: []",
    "      reason: Bound",
    "",
  ].join("\n");

  await withPackDirectory(boundedYaml, async (directory) => {
    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        stderr,
        stdout,
      }),
    ).toBe(2);
  });
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.invalid_condition" },
    ok: false,
  });
});
