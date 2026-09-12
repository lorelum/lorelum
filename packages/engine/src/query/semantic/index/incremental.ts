import {
  revisionDeltaPracticeIds,
  type EffectivePractice,
  type RevisionDelta,
} from "../../../local-store/model";
import { projectSemanticPractice, type SemanticDocument } from "../projection";

export interface ReusableSemanticVector {
  readonly projectionDigest: string;
  readonly vector: Float32Array;
}

export interface IncrementalSemanticIndexPlan {
  /** Delete all rows touched by the revision interval before inserting final rows. */
  readonly removedPracticeIds: readonly string[];
  /** Final canonical documents that need a row in the updated index. */
  readonly documents: readonly SemanticDocument[];
  /** Only these documents require a new embedding request. */
  readonly documentsToEmbed: readonly SemanticDocument[];
  /** Valid unchanged vectors keyed by final Practice ID. */
  readonly reusableVectors: ReadonlyMap<string, Float32Array>;
}

/** Collapse one or more Store revisions to their final document-level index work. */
export function planIncrementalSemanticIndex(
  deltas: readonly RevisionDelta[],
  practices: readonly EffectivePractice[],
  reusable: (practiceId: string) => ReusableSemanticVector | undefined,
): IncrementalSemanticIndexPlan {
  const removedPracticeIds = Object.freeze([...revisionDeltaPracticeIds(deltas, true)].sort());
  const documents = Object.freeze(practices.map(projectSemanticPractice));
  const reusableVectors = new Map<string, Float32Array>();
  const documentsToEmbed: SemanticDocument[] = [];
  for (const document of documents) {
    const prior = reusable(document.practiceId);
    if (prior?.projectionDigest === document.projectionDigest) {
      reusableVectors.set(document.practiceId, prior.vector);
    } else {
      documentsToEmbed.push(document);
    }
  }
  return Object.freeze({
    removedPracticeIds,
    documents,
    documentsToEmbed: Object.freeze(documentsToEmbed),
    reusableVectors,
  });
}
