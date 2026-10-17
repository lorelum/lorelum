import { expect, test } from "bun:test";
import type { EmbeddingPort } from "./encoding";
import { createVectorExecution } from "./profile";
import { resolveVectorRetrievalMethod } from "./methods/catalog";
import type { VectorPracticeScorer, VectorRetrievalMethodId } from "./methods/types";
import { searchSemanticArtifact } from "./read";
import type { SemanticIndexReader } from "./index/reader";
import type { DocumentVector } from "./representation";

const encodingId = "d".repeat(64);

for (const methodId of ["single-vector", "multi-view-vector"] as const) {
  test(`${methodId} skips query encoding when no Practice is eligible`, async () => {
    let calls = 0;
    const reader = { hasEligibleVectors: () => false } as unknown as SemanticIndexReader;
    const embedding: EmbeddingPort = {
      maxBatchSize: 1,
      async embed() {
        calls += 1;
        throw new Error("unexpected embedding");
      },
    };
    expect(
      await searchSemanticArtifact({
        reader,
        execution: createVectorExecution(
          { encodingId, dimensions: 2 },
          resolveVectorRetrievalMethod(methodId),
        ),
        embedding,
        text: "valid query",
        excludedPracticeIds: new Set(),
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });
}

function scoringReader(methodId: VectorRetrievalMethodId, scores: number[]): SemanticIndexReader {
  const channel = methodId === "single-vector" ? "full" : "body";
  const vectors: DocumentVector[] = [
    { inputKey: `${channel}:0000`, channel, ordinal: 0, embedding: new Float32Array([1, 0]) },
  ];
  return {
    hasEligibleVectors: () => true,
    search(scorer: VectorPracticeScorer) {
      scores.push(scorer.score(vectors));
      return [];
    },
  } as unknown as SemanticIndexReader;
}

test("multi-view batches more than eight clauses in order before preparing its real scorer", async () => {
  const text = Array.from({ length: 9 }, (_, index) => `clause ${index}`).join(";");
  const calls: string[][] = [];
  const scores: number[] = [];
  await searchSemanticArtifact({
    reader: scoringReader("multi-view-vector", scores),
    execution: createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    ),
    embedding: {
      maxBatchSize: 1,
      async embed(inputs) {
        calls.push([...inputs]);
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    },
    text,
    excludedPracticeIds: new Set(),
  });
  expect(calls).toEqual(Array.from({ length: 9 }, (_, index) => [`clause ${index}`]));
  expect(scores).toEqual([1]);
});

test("single-vector encodes the complete punctuation-bearing query once", async () => {
  const text = "Check request isolation; preserve cache sharing，确保用户隔离。";
  const calls: string[][] = [];
  const scores: number[] = [];
  await searchSemanticArtifact({
    reader: scoringReader("single-vector", scores),
    execution: createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("single-vector"),
    ),
    embedding: {
      maxBatchSize: 1,
      async embed(inputs) {
        calls.push([...inputs]);
        return { encodingId, vectors: [[0.6, 0.8]] };
      },
    },
    text,
    excludedPracticeIds: new Set(),
  });
  expect(calls).toEqual([[text]]);
  expect(scores[0]).toBeCloseTo(0.6, 6);
});
