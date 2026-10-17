import { SemanticIndexQueryError } from "../../errors";
import type { DocumentVector, QueryVector } from "../../representation";
import { dotProduct, validateQueryVectors } from "../../vector";
import type { VectorPracticeScorer } from "../types";

export const MULTI_VIEW_BODY_EVIDENCE_MIX = 0.5;

function validateDocument(vectors: readonly DocumentVector[], dimensions: number): void {
  if (vectors.length === 0) throw new SemanticIndexQueryError("Multi-view Practice has no inputs");
  for (const vector of vectors) {
    if (
      (vector.channel !== "task-card" && vector.channel !== "body") ||
      !Number.isSafeInteger(vector.ordinal) ||
      vector.ordinal < 0 ||
      vector.embedding.length !== dimensions
    ) {
      throw new SemanticIndexQueryError("Multi-view Practice has an invalid input representation");
    }
  }
}

/** One scorer per query; score uses only local scalar accumulators. */
export function prepareMultiViewScorer(
  queries: readonly QueryVector[],
  dimensions: number,
): VectorPracticeScorer {
  const totalWeight = validateQueryVectors(queries, dimensions);
  return Object.freeze({
    score(vectors) {
      validateDocument(vectors, dimensions);
      let weightedTotal = 0;
      for (const query of queries) {
        let taskMaximum = Number.NEGATIVE_INFINITY;
        let bodyMaximum = Number.NEGATIVE_INFINITY;
        let bodySum = 0;
        let bodyCount = 0;
        for (const vector of vectors) {
          const similarity = dotProduct(query.embedding, vector.embedding);
          if (vector.channel === "task-card") taskMaximum = Math.max(taskMaximum, similarity);
          else {
            bodyMaximum = Math.max(bodyMaximum, similarity);
            bodySum += similarity;
            bodyCount += 1;
          }
        }
        let sum = 0;
        let count = 0;
        if (taskMaximum !== Number.NEGATIVE_INFINITY) {
          sum += taskMaximum;
          count += 1;
        }
        if (bodyCount > 0) {
          sum +=
            MULTI_VIEW_BODY_EVIDENCE_MIX * bodyMaximum +
            ((1 - MULTI_VIEW_BODY_EVIDENCE_MIX) * bodySum) / bodyCount;
          count += 1;
        }
        weightedTotal += (query.weight * sum) / count;
      }
      return weightedTotal / totalWeight;
    },
  } satisfies VectorPracticeScorer);
}

/** Internal benchmark diagnostic, never part of the shared reader or public result. */
export function bestMultiViewInput(
  queries: readonly QueryVector[],
  vectors: readonly DocumentVector[],
  dimensions: number,
): DocumentVector {
  validateQueryVectors(queries, dimensions);
  validateDocument(vectors, dimensions);
  let best: DocumentVector | undefined;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const vector of vectors) {
    for (const query of queries) {
      const similarity = dotProduct(query.embedding, vector.embedding);
      const precedes =
        best === undefined ||
        (vector.channel === "task-card" && best.channel === "body") ||
        (vector.channel === best.channel &&
          (vector.ordinal < best.ordinal ||
            (vector.ordinal === best.ordinal && vector.inputKey < best.inputKey)));
      if (similarity > maximum || (similarity === maximum && precedes)) {
        maximum = similarity;
        best = vector;
      }
    }
  }
  if (best === undefined)
    throw new SemanticIndexQueryError("Multi-view query has no scorable document inputs");
  return best;
}
