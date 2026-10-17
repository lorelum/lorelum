import {
  DEFAULT_VECTOR_RETRIEVAL_METHOD_ID,
  isVectorRetrievalMethodId,
} from "@lorelum/engine/vector-methods";
import type { VectorRetrievalMethodId } from "@lorelum/engine";
import { BackendRemoteError } from "./errors";

/** Method selection is domain input, so invalid IDs use the existing usage error. */
export function resolveRequestedRetrievalMethod(value: unknown): VectorRetrievalMethodId {
  if (value === undefined) return DEFAULT_VECTOR_RETRIEVAL_METHOD_ID;
  if (!isVectorRetrievalMethodId(value)) throw new BackendRemoteError("usage.invalid");
  return value;
}
