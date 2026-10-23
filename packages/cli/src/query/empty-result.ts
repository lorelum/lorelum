import type { QueryContextData } from "./query-command.js";

export type EmptyQueryExplanation = Readonly<{
  reason: "empty" | "corpus-empty";
  nextAction: "refine-query";
  message: string;
}>;

/** Explain only facts supplied by this query, without additional retrieval or diagnosis. */
export function createEmptyQueryExplanation(input: {
  readonly mode: "semantic" | "keyword";
  readonly coverage?: "complete" | "partial" | undefined;
  readonly indexedPracticeCount?: number | undefined;
  readonly totalPracticeCount?: number | undefined;
  readonly emptyReason?: "corpus-empty" | undefined;
  readonly context?: QueryContextData | undefined;
}): EmptyQueryExplanation {
  const boundary = [
    `mode: ${input.mode}`,
    ...(input.coverage === undefined ? [] : [`coverage: ${input.coverage}`]),
    ...(input.coverage === "partial" &&
    input.indexedPracticeCount !== undefined &&
    input.totalPracticeCount !== undefined
      ? [`${input.indexedPracticeCount}/${input.totalPracticeCount} Practices queryable`]
      : []),
  ].join("; ");
  const reason = input.emptyReason ?? "empty";
  const facts = [
    `Query completed successfully but returned no Practices (${boundary}).`,
    reason === "corpus-empty"
      ? "This query context has no retrievable Practices."
      : "No more specific cause is confirmed.",
    ...(input.coverage === "partial" ? ["Only part of the context was queried."] : []),
    ...(input.context?.state === "degraded" || (input.context?.warnings.length ?? 0) > 0
      ? ["Some sources were ignored; see context warnings."]
      : []),
    "Next: rewrite the query once with the decision, constraints, and technology context.",
    ...(reason === "corpus-empty" ? ["Rewriting alone does not add Practices."] : []),
  ];
  return { reason, nextAction: "refine-query", message: facts.join(" ") };
}
