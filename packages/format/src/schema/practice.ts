import { z } from "zod";

import { ID_REGEX, SeverityEnum } from "./common";

/**
 * Anti-pattern: first-class Practice entry with a stable id. `check` is
 * reserved — its format is intentionally undefined in v1 (ADR 0003 §6).
 */
export const AntiPatternSchema = z.object({
  id: z.string().regex(ID_REGEX, "anti-pattern id must be dotted").describe("Stable id, dotted."),
  name: z.string().describe("Human-readable name."),
  description: z.string().describe("Detail consumed by the AI."),
  severity: SeverityEnum.optional(),
  check: z.unknown().optional().describe("Reserved — format undefined in v1 (ADR 0003 §6)."),
});

export type AntiPattern = z.infer<typeof AntiPatternSchema>;

/**
 * Practice frontmatter. `severity` is optional with no schema default — the
 * spec's `warn` default is injected by consumers; leaving the input as-is
 * lets validate detect "author omitted severity" and emit a warning.
 */
export const PracticeSchema = z.object({
  id: z
    .string()
    .regex(ID_REGEX, "practice id must be dotted")
    .describe("Dotted name; lore get key."),
  title: z.string().describe("Human-readable; required for embedding canonical text."),
  stage: z
    .string()
    .describe("Free-form stage, e.g. api-layer / auth / state; used for embedding filtering."),
  tech_stack: z
    .array(z.string())
    .describe("e.g. [react, typescript]; used for embedding filtering."),
  applies_when: z.string().describe("Natural-language applicability; recall core."),
  severity: SeverityEnum.optional(),
  body: z.string().optional().describe("Guidance markdown; embedding canonical text extracts it."),
  anti_patterns: z.array(AntiPatternSchema).optional(),
});

export type Practice = z.infer<typeof PracticeSchema>;
