import { expect, test } from "bun:test";

import { renderQueryDecisionText } from "./text.js";

const hit = {
  practiceId: "sample.react-auth",
  title: "Use the existing authentication service",
  stage: "implementation",
  techStack: ["react"],
  appliesWhen: "adding authentication to a React page",
  severity: "warn",
  contentDigest: "a".repeat(64),
};

test("query text keeps decision fields without metadata repeated by JSON", () => {
  const semantic = renderQueryDecisionText({
    mode: "semantic",
    profileId: "p".repeat(64),
    coverage: "complete",
    results: [hit],
  });
  expect(semantic).toContain("practiceId: sample.react-auth");
  expect(semantic).toContain("appliesWhen: adding authentication");
  expect(semantic).toContain("techStack:");
  expect(semantic).not.toContain("contentDigest:");
  expect(semantic).not.toContain("profileId:");
  expect(semantic).not.toContain("coverage:");
  expect(semantic).not.toContain("severity: warn");

  const keyword = renderQueryDecisionText({
    mode: "keyword",
    results: [{ ...hit, severity: "critical", techStack: [] }],
  });
  expect(keyword).toContain("mode: keyword");
  expect(keyword).toContain("severity: critical");
  expect(keyword).not.toContain("techStack:");
});

test("partial coverage and degraded context remain visible even with no hits", () => {
  const text = renderQueryDecisionText({
    mode: "semantic",
    profileId: "p".repeat(64),
    coverage: "partial",
    indexedPracticeCount: 2,
    totalPracticeCount: 3,
    operationId: "opaque-id",
    results: [],
    context: {
      state: "degraded",
      warnings: [{ code: "practice.invalid", layerDepth: 1, practiceId: "sample.bad" }],
    },
  });
  expect(text).toContain("coverage: partial");
  expect(text).toContain("indexedPracticeCount: 2");
  expect(text).toContain("totalPracticeCount: 3");
  expect(text).toContain("results: []");
  expect(text).toContain("practiceId: sample.bad");
  expect(text).not.toContain("operationId:");
});

test("preparing and indexing text cannot be mistaken for empty results", () => {
  const preparing = renderQueryDecisionText({
    state: "preparing",
    preparationId: "opaque-id",
    message: "Check lore model status, then retry.",
  });
  expect(preparing).toContain("state: preparing");
  expect(preparing).toContain("message: Check lore model status, then retry.");
  expect(preparing).not.toContain("preparationId:");
  expect(preparing).not.toContain("results:");

  const indexing = renderQueryDecisionText({
    state: "indexing",
    operationId: "opaque-id",
    indexedPracticeCount: 2,
    totalPracticeCount: 3,
    message: "Retry shortly.",
  });
  expect(indexing).toContain("state: indexing");
  expect(indexing).toContain("operationId: opaque-id");
  expect(indexing).toContain("indexedPracticeCount: 2");
  expect(indexing).not.toContain("results:");
});
