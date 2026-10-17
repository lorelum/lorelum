import { createHash } from "node:crypto";
import type { EffectivePractice } from "../../local-store";
import type { VectorMethodRecipe } from "./methods/types";
import type { EmbeddingInput, PracticeVectorProjection } from "./representation";

/** Bind addresses and actual text to the method's document recipe, not canonical identity. */
export function createEmbeddingInput(
  recipe: VectorMethodRecipe,
  channel: string,
  ordinal: number,
  text: string,
): EmbeddingInput {
  const inputKey = `${channel}:${ordinal.toString().padStart(4, "0")}`;
  const inputDigest = createHash("sha256")
    .update(
      JSON.stringify([recipe.methodId, recipe.documentVersion, inputKey, channel, ordinal, text]),
    )
    .digest("hex");
  return Object.freeze({ inputKey, channel, ordinal, text, inputDigest });
}

export function createPracticeVectorProjection(
  effective: EffectivePractice,
  recipe: VectorMethodRecipe,
  inputs: readonly EmbeddingInput[],
): PracticeVectorProjection {
  const projectionDigest = createHash("sha256")
    .update(
      JSON.stringify([
        recipe.methodId,
        recipe.documentVersion,
        inputs.map((input) => [input.inputKey, input.channel, input.ordinal, input.inputDigest]),
      ]),
    )
    .digest("hex");
  return Object.freeze({
    practiceId: effective.practiceId,
    contentDigest: effective.contentDigest,
    projectionDigest,
    inputs: Object.freeze(inputs),
  });
}
