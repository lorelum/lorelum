import type { EffectivePractice } from "../../../../local-store";
import { createEmbeddingInput, createPracticeVectorProjection } from "../../projection-identity";
import type { PracticeVectorProjection } from "../../representation";
import type { VectorMethodRecipe } from "../types";

/** The original full-text vector recipe, including labels, IDs and field order. */
export function projectSingleVectorDocument(
  effective: EffectivePractice,
  recipe: VectorMethodRecipe,
): PracticeVectorProjection {
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
  return createPracticeVectorProjection(effective, recipe, [
    createEmbeddingInput(recipe, "full", 0, text),
  ]);
}
