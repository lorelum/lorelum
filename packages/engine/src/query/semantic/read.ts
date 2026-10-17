import type { EffectivePractice } from "../../local-store";
import { parseQueryRequest } from "../request";
import { assembleQueryHits } from "../result";
import { embedInBatches, type EmbeddingPort } from "./encoding";
import { SemanticIndexQueryError } from "./errors";
import type { SemanticCandidate, SemanticIndexReader } from "./index/reader";
import type { EmbeddingProfile, VectorExecution } from "./profile";
import type { QueryVector } from "./representation";
import type { SemanticQueryResult } from "./query-service";

/** Execute the source-neutral reader/embedding half of a semantic query. */
export async function searchSemanticArtifact(input: {
  readonly reader: SemanticIndexReader;
  readonly execution: VectorExecution;
  readonly embedding: EmbeddingPort;
  readonly text: string;
  readonly excludedPracticeIds: ReadonlySet<string>;
}): Promise<readonly SemanticCandidate[]> {
  if (!input.reader.hasEligibleVectors(input.excludedPracticeIds)) return Object.freeze([]);
  // Validate and normalize text through the shared request boundary.
  const text = parseQueryRequest({ text: input.text, limit: 1 }).text;
  const { execution } = input;
  const inputs = execution.method.projectQuery(text);
  const embeddings = await embedInBatches(
    execution.profile,
    input.embedding,
    inputs.map((item) => item.text),
  );
  const queries: readonly QueryVector[] = inputs.map((item, index) => {
    const embedding = embeddings[index];
    if (embedding === undefined) {
      throw new SemanticIndexQueryError("Embedding result did not contain a query input vector");
    }
    return { inputKey: item.inputKey, embedding, weight: item.weight };
  });
  const scorer = execution.method.prepareScorer(queries, execution.profile.dimensions);
  return input.reader.search(scorer, input.excludedPracticeIds);
}

/** Assemble a public semantic result from rows already proven current by the caller. */
export function assembleSemanticArtifactResult(input: {
  readonly profile: EmbeddingProfile;
  readonly coverage: SemanticQueryResult["coverage"];
  readonly practices: readonly EffectivePractice[];
  readonly candidates: readonly SemanticCandidate[];
}): SemanticQueryResult {
  return Object.freeze({
    mode: "semantic",
    profileId: input.profile.profileId,
    coverage: input.coverage,
    results: assembleQueryHits(
      input.practices,
      input.candidates,
      (message) => new SemanticIndexQueryError(message),
    ),
  });
}
