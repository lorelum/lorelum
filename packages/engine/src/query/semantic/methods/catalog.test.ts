import { expect, test } from "bun:test";
import {
  VECTOR_RETRIEVAL_METHOD_IDS,
  isVectorRetrievalMethodId,
  resolveVectorRetrievalMethod,
} from "./catalog";

test("catalog resolves the explicit vector methods", () => {
  expect(VECTOR_RETRIEVAL_METHOD_IDS).toEqual(["single-vector", "multi-view-vector"]);
  for (const id of VECTOR_RETRIEVAL_METHOD_IDS) {
    expect(isVectorRetrievalMethodId(id)).toBe(true);
    expect(resolveVectorRetrievalMethod(id).recipe.methodId).toBe(id);
    expect(resolveVectorRetrievalMethod(id)).toBe(resolveVectorRetrievalMethod(id));
  }
});

test("unknown values and old planning IDs are not accepted as aliases", () => {
  for (const value of [
    undefined,
    null,
    0,
    true,
    {},
    [],
    "simple",
    "multi-view",
    "multiview",
    "Single-vector",
    "",
  ]) {
    expect(isVectorRetrievalMethodId(value)).toBe(false);
  }
});
