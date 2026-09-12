export { createEmbeddingProfile } from "./profile";
export {
  SemanticEmbeddingError,
  SemanticIndexError,
  SemanticIndexSnapshotChangedError,
} from "./errors";
export { createSemanticIndexService } from "./index/service";
export { SEMANTIC_INDEX_VERSION } from "./index/metadata";
export type { EmbeddingBatch, EmbeddingPort, EncodingContract } from "./encoding";
export type { EmbeddingProfile } from "./profile";
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
