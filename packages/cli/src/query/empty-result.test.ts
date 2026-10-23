import { expect, test } from "bun:test";

import { createEmptyQueryExplanation } from "./empty-result.js";

test("keyword empty explanation defaults to continuing with only one optional substantive rewrite", () => {
  const result = createEmptyQueryExplanation({ mode: "keyword" });
  expect(result).toMatchObject({ reason: "empty", nextAction: "continue-task" });
  expect(result.message).toStartWith("Query completed successfully but returned no Practices");
  expect(result.message).toContain("mode: keyword");
  expect(result.message).toContain("No more specific cause is confirmed");
  expect(result.message).toContain("decision, constraints, and technology context");
  expect(result.message).toContain("Only if important context was missing");
  expect(result.message).toContain("at most one substantive rewrite for this lookup");
  expect(result.message).toContain(
    "If the query was already specific or the rewrite is still empty, stop querying",
  );
  expect(result.message).not.toMatch(/lore (index|context|pack|model)|--mode/);
});

test("only the explicit corpus proof yields corpus-empty, not coverage counts", () => {
  const facts = {
    mode: "semantic" as const,
    coverage: "complete" as const,
    indexedPracticeCount: 0,
    totalPracticeCount: 0,
  };
  expect(createEmptyQueryExplanation(facts).reason).toBe("empty");
  const proven = createEmptyQueryExplanation({ ...facts, emptyReason: "corpus-empty" });
  expect(proven.reason).toBe("corpus-empty");
  expect(proven.message).toContain("mode: semantic; coverage: complete");
  expect(proven.message).toContain("This query context has no retrievable Practices");
  expect(proven.nextAction).toBe("continue-task");
  expect(proven.message).toContain("rewriting cannot add Practices to this context");
  expect(proven.message).not.toContain("try at most one");
});

test("partial coverage and ignored sources qualify the same empty result", () => {
  const result = createEmptyQueryExplanation({
    mode: "semantic",
    coverage: "partial",
    indexedPracticeCount: 2,
    totalPracticeCount: 3,
    context: {
      state: "degraded",
      warnings: [{ code: "practice.invalid", layerDepth: 1 }],
    },
  });
  expect(result.reason).toBe("empty");
  expect(result.message).toContain("coverage: partial; 2/3 Practices queryable");
  expect(result.message).toContain("Only part of the context was queried");
  expect(result.message).toContain("Some sources were ignored; see context warnings");
  expect(result.message).not.toContain("no match");
});

test("warnings are visible even if context state is ready", () => {
  const result = createEmptyQueryExplanation({
    mode: "keyword",
    context: { state: "ready", warnings: [{ code: "config.invalid", layerDepth: 0 }] },
  });
  expect(result.message).toContain("see context warnings");
  expect(result.reason).toBe("empty");
});
