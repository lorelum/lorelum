/* eslint-disable no-await-in-loop -- Frozen vectors are encoded sequentially in the native slot. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import frozen from "../../../../docs/research/onnx-validation/quantization-fixture.json";
import type { BackendClient } from "../../src/client/client";
import { assertUnitVector } from "./native";

const vectorReference = z.object({
  vectors: z.array(
    z.object({
      id: z.string(),
      vector: z.array(z.number()).length(384),
    }),
  ),
});
export async function verifyReferences(client: BackendClient, root: string) {
  const baseline = vectorReference.parse(
    JSON.parse(await readFile(join(root, "q4-reference.json"), "utf8")),
  );
  const expected = new Map(baseline.vectors.map((row) => [row.id, row.vector]));
  assert.equal(expected.size, baseline.vectors.length, "Reference vector IDs must be unique");
  const measured = new Map<string, number[]>();
  let minCosine = 1;
  for (const entry of [...frozen.documents, ...frozen.queries]) {
    const kind = "relevantIds" in entry ? "query" : "document";
    const vector = (await client.embed(kind, [entry.text])).vectors[0];
    assertUnitVector(vector);
    measured.set(entry.id, vector);
    minCosine = Math.min(minCosine, cosine(vector, vectorFor(expected, entry.id)));
  }
  const previousRanks = rankDocuments(expected);
  const currentRanks = rankDocuments(measured);
  const reference = retrievalMetrics(previousRanks);
  const current = retrievalMetrics(currentRanks);
  // Frozen fixture regression, not a claim about general retrieval quality.
  assert(minCosine > 0.999, "Frozen vector cosine fell below 0.999");
  assert(current.hits >= reference.hits, "Frozen top-1 retrieval regressed");
  assert(current.ndcg5 + 1e-12 >= reference.ndcg5, "Frozen nDCG@5 regressed");
  const report = {
    scenario: "frozen-reference",
    status: "passed",
    reference,
    current,
    minCosine,
    referenceChecks: measured.size,
    changedTop1: currentRanks.filter((rank, index) => rank[0] !== previousRanks[index]?.[0]).length,
    changedTop5: currentRanks.filter(
      (rank, index) => JSON.stringify(rank) !== JSON.stringify(previousRanks[index]),
    ).length,
  };
  console.log(JSON.stringify(report));
  return report;
}

function vectorFor(vectors: Map<string, number[]>, id: string): number[] {
  const vector = vectors.get(id);
  assert(vector, `Missing vector for fixture ${id}`);
  return vector;
}
function dot(left: number[], right: number[]): number {
  assert.equal(left.length, right.length, "Compared vector dimensions must match");
  return left.reduce((sum, value, index) => {
    const component = right[index];
    assert(component !== undefined, `Missing vector component ${index}`);
    return sum + value * component;
  }, 0);
}
function cosine(left: number[], right: number[]): number {
  const norm = Math.sqrt(dot(left, left) * dot(right, right));
  assert(norm > 0, "Reference vector must have a nonzero norm");
  return dot(left, right) / norm;
}
function rankDocuments(vectors: Map<string, number[]>): string[][] {
  return frozen.queries.map((query) =>
    frozen.documents
      .map((doc) => ({
        id: doc.id,
        score: dot(vectorFor(vectors, query.id), vectorFor(vectors, doc.id)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((row) => row.id),
  );
}
function retrievalMetrics(ranks: string[][]) {
  let hits = 0,
    ndcg = 0;
  assert(frozen.queries.length > 0, "Retrieval fixture requires queries");
  for (const [index, query] of frozen.queries.entries()) {
    const rank = ranks[index];
    assert(rank?.[0], `Missing ranking for ${query.id}`);
    assert(query.relevantIds.length > 0, `Missing relevance labels for ${query.id}`);
    if (query.relevantIds.includes(rank[0])) hits++;
    const dcg = rank.reduce(
      (sum, id, position) =>
        sum + (query.relevantIds.includes(id) ? 1 / Math.log2(position + 2) : 0),
      0,
    );
    const ideal = query.relevantIds
      .slice(0, 5)
      .reduce((sum, _, position) => sum + 1 / Math.log2(position + 2), 0);
    ndcg += dcg / ideal;
  }
  return { hits, ndcg5: ndcg / ranks.length };
}
