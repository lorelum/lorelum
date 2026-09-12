import type { StoreSnapshotIdentity } from "../../../local-store";
import type { EmbeddingProfile } from "../profile";
import { SemanticIndexError } from "../errors";

export const SEMANTIC_INDEX_VERSION = 1;

export type SemanticIndexState = "missing" | "ready" | "stale" | "incompatible";

export interface SemanticIndexMetadata {
  readonly indexVersion: number;
  readonly rootBinding: string;
  readonly generation: number;
  readonly effectiveRevision: number;
  readonly manifestDigest: string;
  readonly profileId: string;
  readonly encodingId: string;
  readonly dimensions: number;
  readonly documentProjectionVersion: number;
  readonly normalization: "l2";
  readonly vectorCount: number;
}

export interface SemanticIndexStatus {
  readonly state: SemanticIndexState;
  readonly profileId: string;
  readonly vectorCount?: number;
}

export function metadataFor(
  identity: StoreSnapshotIdentity,
  profile: EmbeddingProfile,
  vectorCount: number,
): SemanticIndexMetadata {
  if (!Number.isSafeInteger(vectorCount) || vectorCount < 0) {
    throw new SemanticIndexError("Semantic index vector count is invalid");
  }
  return Object.freeze({
    indexVersion: SEMANTIC_INDEX_VERSION,
    rootBinding: identity.rootBinding,
    generation: identity.generation,
    effectiveRevision: identity.effectiveRevision,
    manifestDigest: identity.manifestDigest,
    profileId: profile.profileId,
    encodingId: profile.encodingId,
    dimensions: profile.dimensions,
    documentProjectionVersion: profile.documentProjectionVersion,
    normalization: profile.normalization,
    vectorCount,
  });
}

export function stateForMetadata(
  metadata: SemanticIndexMetadata,
  identity: StoreSnapshotIdentity,
  profile: EmbeddingProfile,
): SemanticIndexState {
  if (!isCompatibleMetadata(metadata, profile, identity.rootBinding)) {
    return "incompatible";
  }
  return metadata.generation === identity.generation &&
    metadata.effectiveRevision === identity.effectiveRevision &&
    metadata.manifestDigest === identity.manifestDigest
    ? "ready"
    : "stale";
}

/** Compatibility that does not require the index to be current at this exact Store revision. */
export function isCompatibleMetadata(
  metadata: SemanticIndexMetadata,
  profile: EmbeddingProfile,
  rootBinding: string,
): boolean {
  return (
    metadata.indexVersion === SEMANTIC_INDEX_VERSION &&
    metadata.profileId === profile.profileId &&
    metadata.encodingId === profile.encodingId &&
    metadata.dimensions === profile.dimensions &&
    metadata.documentProjectionVersion === profile.documentProjectionVersion &&
    metadata.normalization === profile.normalization &&
    metadata.rootBinding === rootBinding
  );
}

export function statusFor(
  state: SemanticIndexState,
  profile: EmbeddingProfile,
  metadata?: SemanticIndexMetadata,
): SemanticIndexStatus {
  return Object.freeze({
    state,
    profileId: profile.profileId,
    ...(metadata === undefined ? {} : { vectorCount: metadata.vectorCount }),
  });
}
