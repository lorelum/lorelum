import { describe, expect, test } from "bun:test";

import type { EffectivePractice } from "../local-store/model/types.js";
import { retrievePractices } from "./retrieve.js";

function effectivePractice(
  id: string,
  overrides: Partial<EffectivePractice["practice"]> = {},
): EffectivePractice {
  const practice: EffectivePractice["practice"] = {
    id,
    title: `Practice ${id}`,
    stage: "test",
    tech_stack: ["typescript"],
    applies_when: "testing query retrieval",
    severity: "warn",
    body: `Guidance for ${id}.`,
    anti_patterns: [],
    ...overrides,
  };
  return {
    practiceId: id,
    contentDigest: `${id}-digest`,
    canonicalContent: id,
    practice,
    sources: [
      {
        packName: `pack-${id.replaceAll(".", "-")}`,
        practiceId: id,
        contentDigest: `${id}-digest`,
        sourcePath: `practices/${id}.md`,
        canonicalPractice: { practice, canonicalContent: id, contentDigest: `${id}-digest` },
      },
    ],
  };
}

const layeredApi = effectivePractice("react.api-client", {
  title: "Layer React API access",
  stage: "api-layer",
  tech_stack: ["react", "typescript"],
  applies_when: "adding remote requests to a React interface",
  body: "Keep transport behind a feature API boundary.",
});

const resourceState = effectivePractice("react.resource-state", {
  title: "Separate resource and UI state",
  stage: "state",
  tech_stack: ["react", "typescript"],
  applies_when: "storing remote resource data used by a React interface",
  body: "Model resource data separately from view state.",
});

describe("retrievePractices", () => {
  test("ranks title and applies_when matches above body-only matches", () => {
    const result = retrievePractices({
      effectivePractices: [layeredApi, resourceState],
      query: "remote requests React interface",
    });

    expect(result.total).toBe(2);
    expect(result.results[0]?.id).toBe("react.api-client");
  });

  test("breaks equal-score ties by ascending Practice id", () => {
    const tiedA = effectivePractice("react.b-tied", { applies_when: "same wording" });
    const tiedB = effectivePractice("react.a-tied", { applies_when: "same wording" });

    const result = retrievePractices({
      effectivePractices: [tiedA, tiedB],
      query: "same wording",
    });
    expect(result.results.map((practice) => practice.id)).toEqual(["react.a-tied", "react.b-tied"]);
  });

  test("caps results while total counts every match and repeated tokens count once", () => {
    const third = effectivePractice("react.modal", {
      title: "Modal focus management",
      applies_when: "rendering an accessible modal",
    });
    const result = retrievePractices({
      effectivePractices: [layeredApi, resourceState, third],
      query: "react react interface modal",
      topK: 2,
    });

    expect(result.k).toBe(2);
    expect(result.total).toBe(3);
    expect(result.results.map((practice) => practice.id)).toEqual([
      "react.api-client",
      "react.modal",
    ]);
  });

  test("returns a successful empty result for queries without tokens", () => {
    const result = retrievePractices({
      effectivePractices: [layeredApi],
      query: "   ",
    });

    expect(result).toEqual({ query: "   ", k: 5, total: 0, results: [] });
  });

  test("returns summary metadata without the Practice body", () => {
    const result = retrievePractices({
      effectivePractices: [layeredApi],
      query: "API client",
    });

    expect(result.results[0]).toEqual({
      id: "react.api-client",
      title: "Layer React API access",
      stage: "api-layer",
      tech_stack: ["react", "typescript"],
      applies_when: "adding remote requests to a React interface",
    });
    expect("body" in result.results[0]!).toBe(false);
  });

  test("matches contiguous Chinese text with overlapping bigrams", () => {
    const chinese = effectivePractice("react.chinese", {
      title: "组件内直接请求的分层方案",
      applies_when: "在 React 组件内新增远程请求",
    });

    const result = retrievePractices({
      effectivePractices: [chinese],
      query: "在组件内新增请求",
    });
    expect(result.total).toBe(1);
    expect(result.results[0]?.id).toBe("react.chinese");
  });
});
