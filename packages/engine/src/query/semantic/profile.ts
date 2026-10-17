import { createHash } from "node:crypto";
import { assertEncodingContract, type EncodingContract } from "./encoding";
import type { VectorRetrievalMethod, VectorRetrievalMethodId } from "./methods/types";

export const SEMANTIC_NORMALIZATION = "l2" as const;
const vectorExecutionBrand: unique symbol = Symbol("VectorExecution");

export interface EmbeddingProfile extends EncodingContract {
  readonly profileId: string;
  readonly methodId: VectorRetrievalMethodId;
  readonly documentProjectionVersion: number;
  readonly queryProjectionVersion: number;
  readonly scoringVersion: number;
  readonly normalization: typeof SEMANTIC_NORMALIZATION;
}

export interface VectorExecution {
  readonly method: VectorRetrievalMethod;
  readonly profile: EmbeddingProfile;
  readonly [vectorExecutionBrand]: true;
}

/** Bind one complete algorithm recipe to the model's encoding contract. */
export function createVectorExecution(
  encoding: EncodingContract,
  method: VectorRetrievalMethod,
): VectorExecution {
  assertEncodingContract(encoding);
  const { recipe } = method;
  const identity = {
    encodingId: encoding.encodingId,
    dimensions: encoding.dimensions,
    methodId: recipe.methodId,
    documentProjectionVersion: recipe.documentVersion,
    queryProjectionVersion: recipe.queryVersion,
    scoringVersion: recipe.scoringVersion,
    normalization: SEMANTIC_NORMALIZATION,
    distanceMetric: "cosine",
  };
  const profile: EmbeddingProfile = Object.freeze({
    encodingId: encoding.encodingId,
    dimensions: encoding.dimensions,
    methodId: recipe.methodId,
    documentProjectionVersion: recipe.documentVersion,
    queryProjectionVersion: recipe.queryVersion,
    scoringVersion: recipe.scoringVersion,
    normalization: SEMANTIC_NORMALIZATION,
    profileId: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
  });
  return Object.freeze({ method, profile, [vectorExecutionBrand]: true as const });
}
