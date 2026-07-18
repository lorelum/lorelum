import { z } from "zod";

import { ID_REGEX, SeverityEnum } from "./common";

/**
 * Anti-pattern: first-class Practice entry with a stable id. `check` is
 * reserved — its format is intentionally undefined in v1 (ADR 0003 §6).
 */
export const AntiPatternSchema = z.object({
  id: z.string().regex(ID_REGEX, "anti-pattern id must be dotted"),
  name: z.string(),
  description: z.string(),
  severity: SeverityEnum.optional(),
  check: z.unknown().optional(),
});

export type AntiPattern = z.infer<typeof AntiPatternSchema>;

/**
 * Practice frontmatter. `severity` is optional with no schema default — the
 * spec's `warn` default is injected by consumers; leaving the input as-is
 * lets validate detect "author omitted severity" and emit a warning.
 */
export const PracticeSchema = z.object({
  id: z.string().regex(ID_REGEX, "practice id must be dotted"),
  title: z.string(),
  stage: z.string(),
  tech_stack: z.array(z.string()),
  applies_when: z.string(),
  severity: SeverityEnum.optional(),
  body: z.string().optional(),
  anti_patterns: z.array(AntiPatternSchema).optional(),
});

export type Practice = z.infer<typeof PracticeSchema>;
