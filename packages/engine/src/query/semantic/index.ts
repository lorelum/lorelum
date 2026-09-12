export { createEmbeddingProfile } from "./profile";
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
export { SEMANTIC_INDEX_VERSION } from "./index/metadata";
export type { EmbeddingBatch, EmbeddingPort, EncodingContract } from "./encoding";
export type { EmbeddingProfile } from "./profile";
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
