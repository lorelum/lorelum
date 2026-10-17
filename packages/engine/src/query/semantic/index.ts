export { createVectorExecution } from "./profile";
export {
  resolveVectorRetrievalMethod,
  VECTOR_RETRIEVAL_METHOD_IDS,
  DEFAULT_VECTOR_RETRIEVAL_METHOD_ID,
  isVectorRetrievalMethodId,
} from "./methods/catalog";
export type {
  VectorRetrievalMethodId,
  VectorMethodRecipe,
  VectorRetrievalMethod,
  VectorPracticeScorer,
} from "./methods/types";
export type {
  EmbeddingInput,
  PracticeVectorProjection,
  DocumentVector,
  QueryEmbeddingInput,
  QueryVector,
} from "./representation";
export {
  SemanticEmbeddingError,
  SemanticIndexIncompatibleError,
  SemanticIndexError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
  SemanticIndexSnapshotChangedError,
} from "./errors";
export { createSemanticIndexService } from "./index/service";
export { createSemanticQueryService } from "./query-service";
export { assembleSemanticArtifactResult, searchSemanticArtifact } from "./read";
export { SEMANTIC_INDEX_VERSION } from "./index/metadata";
export type { EmbeddingBatch, EmbeddingPort, EncodingContract } from "./encoding";
export type { EmbeddingProfile, VectorExecution } from "./profile";
export type {
  SemanticQueryDependencies,
  SemanticQueryResult,
  SemanticQueryService,
} from "./query-service";
export type {
  SemanticIndexBuildResult,
  SemanticIndexDependencies,
  SemanticIndexService,
} from "./index/service";
export type {
  SemanticIndexMetadata,
  SemanticIndexState,
  SemanticIndexStatus,
} from "./index/metadata";
