import type { EffectivePractice } from "../../../local-store";
import type {
  DocumentVector,
  PracticeVectorProjection,
  QueryEmbeddingInput,
  QueryVector,
} from "../representation";

export type VectorRetrievalMethodId = "single-vector" | "multi-view-vector";

export interface VectorMethodRecipe {
  readonly methodId: VectorRetrievalMethodId;
  readonly documentVersion: number;
  readonly queryVersion: number;
  readonly scoringVersion: number;
}

export interface VectorPracticeScorer {
  score(vectors: readonly DocumentVector[]): number;
}

export interface VectorRetrievalMethod {
  readonly recipe: VectorMethodRecipe;
  projectDocument(practice: EffectivePractice): PracticeVectorProjection;
  projectQuery(text: string): readonly QueryEmbeddingInput[];
  prepareScorer(queries: readonly QueryVector[], dimensions: number): VectorPracticeScorer;
}
