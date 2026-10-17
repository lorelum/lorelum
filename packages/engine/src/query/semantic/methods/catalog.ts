import { multiViewMethod } from "./multi-view/method";
import { singleVectorMethod } from "./single-vector/method";
import type { VectorRetrievalMethod, VectorRetrievalMethodId } from "./types";

export const VECTOR_RETRIEVAL_METHOD_IDS = Object.freeze([
  "single-vector",
  "multi-view-vector",
] as const);
export const DEFAULT_VECTOR_RETRIEVAL_METHOD_ID: VectorRetrievalMethodId = "single-vector";

export function isVectorRetrievalMethodId(value: unknown): value is VectorRetrievalMethodId {
  for (const id of VECTOR_RETRIEVAL_METHOD_IDS) {
    if (value === id) return true;
  }
  return false;
}

const METHODS: Readonly<Record<VectorRetrievalMethodId, VectorRetrievalMethod>> = Object.freeze({
  "single-vector": singleVectorMethod,
  "multi-view-vector": multiViewMethod,
});

export function resolveVectorRetrievalMethod(id: VectorRetrievalMethodId): VectorRetrievalMethod {
  return METHODS[id];
}
