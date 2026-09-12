import { createHash } from "node:crypto";

import { assertEncodingContract, type EncodingContract } from "./encoding";

export const SEMANTIC_PROJECTION_VERSION = 1;
export const SEMANTIC_NORMALIZATION = "l2" as const;
// Retain the original hash input while the persisted v1 Profile directory remains compatible.
const PERSISTED_QUERY_PROJECTION_VERSION = SEMANTIC_PROJECTION_VERSION;
const PERSISTED_DISTANCE_METRIC = "cosine";

export interface EmbeddingProfile extends EncodingContract {
  readonly profileId: string;
  readonly documentProjectionVersion: number;
  readonly normalization: typeof SEMANTIC_NORMALIZATION;
}

/** Create the fixed v1 Profile identity without importing a Backend model implementation. */
export function createEmbeddingProfile(contract: EncodingContract): EmbeddingProfile {
  assertEncodingContract(contract);
  const identity = JSON.stringify({
    encodingId: contract.encodingId,
    dimensions: contract.dimensions,
    documentProjectionVersion: SEMANTIC_PROJECTION_VERSION,
    queryProjectionVersion: PERSISTED_QUERY_PROJECTION_VERSION,
    normalization: SEMANTIC_NORMALIZATION,
    distanceMetric: PERSISTED_DISTANCE_METRIC,
  });
  return Object.freeze({
    ...contract,
    profileId: createHash("sha256").update(identity).digest("hex"),
    documentProjectionVersion: SEMANTIC_PROJECTION_VERSION,
    normalization: SEMANTIC_NORMALIZATION,
  });
}
