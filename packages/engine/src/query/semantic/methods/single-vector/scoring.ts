import { SemanticIndexQueryError } from "../../errors";
import type { QueryVector } from "../../representation";
import { dotProduct, validateQueryVectors } from "../../vector";
import type { VectorPracticeScorer } from "../types";

export function prepareSingleVectorScorer(
  queries: readonly QueryVector[],
  dimensions: number,
): VectorPracticeScorer {
  validateQueryVectors(queries, dimensions);
  if (queries.length !== 1 || queries[0]!.weight !== 1) {
    throw new SemanticIndexQueryError("Single-vector queries require one input with weight one");
  }
  const query = queries[0]!.embedding;
  return Object.freeze({
    score(vectors) {
      const vector = vectors[0];
      if (
        vectors.length !== 1 ||
        vector?.channel !== "full" ||
        vector.inputKey !== "full:0000" ||
        vector.ordinal !== 0
      ) {
        throw new SemanticIndexQueryError("Single-vector Practice requires exactly one full input");
      }
      return dotProduct(query, vector.embedding);
    },
  } satisfies VectorPracticeScorer);
}
