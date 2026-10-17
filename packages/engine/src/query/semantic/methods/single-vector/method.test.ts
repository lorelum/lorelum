import { expect, test } from "bun:test";
import { canonicalizePractice } from "../../../../local-store/model";
import { singleVectorMethod, singleVectorRecipe } from "./method";
import { projectSingleVectorDocument } from "./projection";
import { SemanticIndexQueryError } from "../../errors";

function practice(body?: string) {
  return {
    practiceId: "platform.baseline",
    sources: [],
    ...canonicalizePractice({
      id: "platform.baseline",
      title: "Baseline",
      applies_when: "A complete request needs context.",
      tech_stack: ["typescript", "bun"],
      stage: "implementation",
      severity: "warn",
      anti_patterns: [
        { id: "drop-context", name: "Dropping context", description: "Do not omit the premise." },
      ],
      ...(body === undefined ? {} : { body }),
    }),
  };
}

test("single-vector restores every original field, label, ID and field order", () => {
  const result = singleVectorMethod.projectDocument(
    practice("## Details\n\nKeep the complete body."),
  );
  expect(result.inputs).toHaveLength(1);
  expect(result.inputs[0]).toMatchObject({ inputKey: "full:0000", channel: "full", ordinal: 0 });
  expect(result.inputs[0]!.text).toBe(
    [
      "Practice: platform.baseline",
      "Title: Baseline",
      "Applies when: A complete request needs context.",
      "Tech stack: typescript, bun",
      "Stage: implementation",
      "Anti-patterns:\ndrop-context\nDropping context\nDo not omit the premise.",
      "Guidance:\n## Details\n\nKeep the complete body.",
    ].join("\n\n"),
  );
});

test("full text remains one input without truncation or chunking and absent body has no label", () => {
  const body = "长正文。".repeat(800);
  const long = singleVectorMethod.projectDocument(practice(body));
  expect(long.inputs).toHaveLength(1);
  expect(long.inputs[0]!.text).toEndWith(body);
  expect(singleVectorMethod.projectDocument(practice()).inputs[0]!.text).not.toContain("Guidance:");
});

test("punctuation-bearing query remains one complete input with unit weight", () => {
  const text = "Review the request; keep context，保留全部前提。";
  expect(singleVectorMethod.projectQuery(text)).toEqual([
    { inputKey: "full:0000", text, weight: 1 },
  ]);
});

test("same address changes digest when its text or document recipe changes", () => {
  const first = singleVectorMethod.projectDocument(practice("first body"));
  const second = singleVectorMethod.projectDocument(practice("second body"));
  const revised = projectSingleVectorDocument(practice("first body"), {
    ...singleVectorRecipe,
    documentVersion: 2,
  });
  expect(first.inputs[0]!.inputKey).toBe(second.inputs[0]!.inputKey);
  expect(first.inputs[0]!.inputDigest).not.toBe(second.inputs[0]!.inputDigest);
  expect(first.projectionDigest).not.toBe(second.projectionDigest);
  expect(first.inputs[0]!.inputDigest).not.toBe(revised.inputs[0]!.inputDigest);
});

test("normalized full-vector cosine alone determines scores and invalid representations fail", () => {
  const scorer = singleVectorMethod.prepareScorer(
    [{ inputKey: "full:0000", embedding: new Float32Array([1, 0]), weight: 1 }],
    2,
  );
  const input = { inputKey: "full:0000", channel: "full", ordinal: 0 };
  expect(scorer.score([{ ...input, embedding: new Float32Array([0.8, 0.6]) }])).toBeCloseTo(0.8, 6);
  expect(scorer.score([{ ...input, embedding: new Float32Array([0, 1]) }])).toBe(0);
  expect(() =>
    scorer.score([{ ...input, channel: "body", embedding: new Float32Array([1, 0]) }]),
  ).toThrow(SemanticIndexQueryError);
});
