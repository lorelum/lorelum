import { SemanticIndexQueryError } from "./errors";
import type { QueryVector } from "./representation";

export function dotProduct(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new SemanticIndexQueryError("Semantic vector dimensions are invalid");
  }
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!;
  if (!Number.isFinite(score))
    throw new SemanticIndexQueryError("Semantic similarity is not finite");
  return score;
}

/** Validate once per request before preparing a scorer. */
export function validateQueryVectors(queries: readonly QueryVector[], dimensions: number): number {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || queries.length === 0) {
    throw new SemanticIndexQueryError("Semantic query has invalid vector dimensions or no inputs");
  }
  const keys = new Set<string>();
  let total = 0;
  for (const query of queries) {
    if (
      !query.inputKey ||
      keys.has(query.inputKey) ||
      query.embedding.length !== dimensions ||
      !Number.isFinite(query.weight) ||
      query.weight < 0
    ) {
      throw new SemanticIndexQueryError("Semantic query vector input is invalid");
    }
    // Scorer preparation also accepts direct query vectors; reject non-finite
    // components here without repeating the native boundary's L2 validation.
    for (const value of query.embedding) {
      if (!Number.isFinite(value)) {
        throw new SemanticIndexQueryError("Semantic query vector is not finite");
      }
    }
    keys.add(query.inputKey);
    total += query.weight;
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new SemanticIndexQueryError("Semantic query vector weights have no finite positive mass");
  }
  return total;
}
