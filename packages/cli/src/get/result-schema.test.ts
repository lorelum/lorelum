import { expect, test } from "bun:test";

import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { getResultSchema } from "./result-schema.js";

const result = {
  practice: {
    id: "example.read",
    title: "Read",
    stage: "verification",
    tech_stack: [],
    applies_when: "when reading installed guidance",
    severity: "warn",
    body: "",
    anti_patterns: [],
  },
  contentDigest: "0".repeat(64),
  sources: [{ packName: "example", sourcePath: "practices/read.md" }],
};

test("requires normalized fields even when the author omitted them", () => {
  expect(validateJsonSchema(result, getResultSchema)).toEqual([]);
  for (const field of ["severity", "body", "anti_patterns"]) {
    const practice: Record<string, unknown> = { ...result.practice };
    delete practice[field];
    expect(validateJsonSchema({ ...result, practice }, getResultSchema)).not.toEqual([]);
  }
});

test("rejects invalid runtime content and internal representations", () => {
  for (const candidate of [
    { ...result, canonicalContent: "internal" },
    { ...result, practice: { ...result.practice, body: 42 } },
    { ...result, practice: { ...result.practice, severity: "unknown" } },
    {
      ...result,
      practice: {
        ...result.practice,
        anti_patterns: [{ id: "example.bad", name: "Bad", description: "Bad" }],
      },
    },
    { ...result, sources: [{ ...result.sources[0], canonicalPractice: result.practice }] },
  ]) {
    expect(validateJsonSchema(candidate, getResultSchema)).not.toEqual([]);
  }
});
