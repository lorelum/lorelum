import { z } from "zod";

import { ID_REGEX } from "./common";

/**
 * One branch of a Decision Node. `recommend` references Practice ids only;
 * the optional `next` references another Decision id (ADR 0003 §1.4) — cycle
 * detection (validate) runs over `next` edges.
 */
export const DecisionBranchSchema = z.object({
  when: z.string(),
  recommend: z.array(z.string().regex(ID_REGEX)),
  reason: z.string(),
  next: z.string().regex(ID_REGEX).optional(),
});

export type DecisionBranch = z.infer<typeof DecisionBranchSchema>;

export const DecisionNodeSchema = z.object({
  id: z.string().regex(ID_REGEX, "decision id must be dotted"),
  question: z.string(),
  branches: z.array(DecisionBranchSchema),
});

export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
