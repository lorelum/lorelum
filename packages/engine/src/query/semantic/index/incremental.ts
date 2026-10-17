import {
  revisionDeltaPracticeIds,
  type EffectivePractice,
  type RevisionDelta,
} from "../../../local-store/model";
import type { VectorRetrievalMethod } from "../methods/types";
import type { EmbeddingInput, PracticeVectorProjection } from "../representation";

export interface ReusableSemanticVector {
  readonly inputKey: string;
  readonly inputDigest: string;
  readonly embedding: Float32Array;
}

export interface IncrementalSemanticIndexPlan {
  /** Replace each touched Practice's entire input set atomically. */
  readonly removedPracticeIds: readonly string[];
  readonly documents: readonly PracticeVectorProjection[];
  readonly inputsToEmbed: readonly EmbeddingInput[];
  /** Embeddings keyed by input digest, never by an address shared across Practices. */
  readonly reusableVectors: ReadonlyMap<string, Float32Array>;
}

/** Collapse retained Store revisions to their final method-bound projection work. */
export function planIncrementalSemanticIndex(
  deltas: readonly RevisionDelta[],
  practices: readonly EffectivePractice[],
  reusable: (practiceId: string) => readonly ReusableSemanticVector[] | undefined,
  method: VectorRetrievalMethod,
): IncrementalSemanticIndexPlan {
  const removedPracticeIds = Object.freeze([...revisionDeltaPracticeIds(deltas, true)].sort());
  const documents = Object.freeze(practices.map((practice) => method.projectDocument(practice)));
  const reusableVectors = new Map<string, Float32Array>();
  const inputsToEmbed: EmbeddingInput[] = [];
  for (const document of documents) {
    const priorByKey = new Map(
      (reusable(document.practiceId) ?? []).map((item) => [item.inputKey, item] as const),
    );
    for (const input of document.inputs) {
      const prior = priorByKey.get(input.inputKey);
      if (prior?.inputDigest === input.inputDigest) {
        reusableVectors.set(input.inputDigest, prior.embedding);
      } else {
        inputsToEmbed.push(input);
      }
    }
  }
  return Object.freeze({
    removedPracticeIds,
    documents,
    inputsToEmbed: Object.freeze(inputsToEmbed),
    reusableVectors,
  });
}
