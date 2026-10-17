import type { VectorMethodRecipe, VectorRetrievalMethod } from "../types";
import { projectSingleVectorDocument } from "./projection";
import { prepareSingleVectorScorer } from "./scoring";

export const singleVectorRecipe: VectorMethodRecipe = Object.freeze({
  methodId: "single-vector",
  documentVersion: 1,
  queryVersion: 1,
  scoringVersion: 1,
});

export const singleVectorMethod = Object.freeze<VectorRetrievalMethod>({
  recipe: singleVectorRecipe,
  projectDocument: (practice) => projectSingleVectorDocument(practice, singleVectorRecipe),
  projectQuery: (text) =>
    Object.freeze([Object.freeze({ inputKey: "full:0000", text, weight: 1 })]),
  prepareScorer: prepareSingleVectorScorer,
});
