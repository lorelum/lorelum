import type { VectorMethodRecipe, VectorRetrievalMethod } from "../types";
import { projectMultiViewDocument } from "./projection";
import { projectMultiViewQuery } from "./query-views";
import { prepareMultiViewScorer } from "./scoring";

export const multiViewRecipe: VectorMethodRecipe = Object.freeze({
  methodId: "multi-view-vector",
  documentVersion: 5,
  queryVersion: 2,
  scoringVersion: 1,
});

export const multiViewMethod = Object.freeze<VectorRetrievalMethod>({
  recipe: multiViewRecipe,
  projectDocument: (practice) => projectMultiViewDocument(practice, multiViewRecipe),
  projectQuery: projectMultiViewQuery,
  prepareScorer: prepareMultiViewScorer,
});
