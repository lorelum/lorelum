import { z } from "zod";

import { ID_REGEX } from "./common";

/**
 * One branch of a Decision Node. `recommend` references Practice ids only;
 * the optional `next` references another Decision id (ADR 0003 §1.4) — cycle
 * detection (validate) runs over `next` edges.
 */
export const DecisionBranchSchema = z.object({
  when: z.string().describe("Condition expression."),
  recommend: z.array(z.string().regex(ID_REGEX)).describe("Practice ids only."),
  reason: z.string().describe("Why this recommendation."),
  next: z
    .string()
    .regex(ID_REGEX)
    .optional()
    .describe("Reference to another Decision id for chaining; cycle detection runs over next."),
});

export type DecisionBranch = z.infer<typeof DecisionBranchSchema>;

export const DecisionNodeSchema = z.object({
  id: z.string().regex(ID_REGEX, "decision id must be dotted").describe("Dotted name."),
  question: z.string().describe("What this decision answers."),
  branches: z.array(DecisionBranchSchema).describe("Conditional branches."),
});

export type DecisionNode = z.infer<typeof DecisionNodeSchema>;

/** Thrown when a decisions document is not a valid list of Decision Nodes. */
export class DecisionDocumentError extends Error {
  constructor() {
    super("The decisions document is not a list of decision nodes.");
    this.name = "DecisionDocumentError";
  }
}

/**
 * Parse a runtime decisions document so the format layer does not depend on
 * CLI error codes. An empty YAML document (null) and an absent document
 * (undefined) both normalize to an empty decision list.
 */
export function parseDecisionDocument(input: unknown): DecisionNode[] {
  const result = DecisionNodeSchema.array().safeParse(input ?? []);
  if (!result.success) throw new DecisionDocumentError();
  return result.data;
}
