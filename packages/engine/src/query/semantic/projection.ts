import { createHash } from "node:crypto";

import type { EffectivePractice } from "../../local-store";

export interface SemanticDocument {
  readonly practiceId: string;
  readonly contentDigest: string;
  readonly projectionDigest: string;
  readonly text: string;
}

/** Deterministic v1 document projection. The index never becomes the canonical content source. */
export function projectSemanticPractice(effective: EffectivePractice): SemanticDocument {
  const { practice } = effective;
  const antiPatterns =
    practice.anti_patterns
      ?.map((antiPattern) => [antiPattern.id, antiPattern.name, antiPattern.description].join("\n"))
      .join("\n\n") ?? "";
  const text = [
    `Practice: ${practice.id}`,
    `Title: ${practice.title}`,
    `Applies when: ${practice.applies_when}`,
    `Tech stack: ${practice.tech_stack.join(", ")}`,
    `Stage: ${practice.stage}`,
    antiPatterns.length > 0 ? `Anti-patterns:\n${antiPatterns}` : "",
    practice.body ? `Guidance:\n${practice.body}` : "",
  ]
    .filter((value) => value.length > 0)
    .join("\n\n");
  return Object.freeze({
    practiceId: effective.practiceId,
    contentDigest: effective.contentDigest,
    projectionDigest: createHash("sha256").update(text).digest("hex"),
    text,
  });
}
