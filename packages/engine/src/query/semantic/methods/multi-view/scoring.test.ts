import { expect, test } from "bun:test";
import type { DocumentVector, QueryVector } from "../../representation";
import { SemanticIndexQueryError } from "../../errors";
import { bestMultiViewInput, prepareMultiViewScorer } from "./scoring";

function document(inputKey: string, channel: string, values: readonly number[]): DocumentVector {
  return {
    inputKey,
    channel,
    ordinal: Number(inputKey.split(":")[1]),
    embedding: Float32Array.from(values),
  };
}
function query(values: readonly number[], weight = 1, inputKey = "clause:0000"): QueryVector {
  return { inputKey, embedding: Float32Array.from(values), weight };
}

test("full is ignored and task-card maximum balances body maximum/mean evidence", () => {
  const queries = [query([1, 0])];
  const vectors = [
    document("full:0000", "full", [1, 0]),
    document("task-card:0000", "task-card", [0.2, 0.9797959]),
    document("body:0000", "body", [0.8, 0.6]),
    document("body:0001", "body", [0, 1]),
  ];
  expect(prepareMultiViewScorer(queries, 2).score(vectors)).toBeCloseTo(0.4, 6);
  expect(bestMultiViewInput(queries, vectors, 2).inputKey).toBe("body:0000");
});

test("additional identical body chunks cannot linearly raise a score", () => {
  const scorer = prepareMultiViewScorer([query([0.8, 0.6])], 2);
  expect(scorer.score([document("body:0000", "body", [1, 0])])).toBeCloseTo(0.8, 6);
  expect(
    scorer.score(
      [0, 1, 2].map((ordinal) =>
        document(`body:${String(ordinal).padStart(4, "0")}`, "body", [1, 0]),
      ),
    ),
  ).toBeCloseTo(0.8, 6);
});

test("a background-only clause cannot carry the Practice and clause weights control averaging", () => {
  const vectors = [document("body:0000", "body", [1, 0])];
  expect(
    prepareMultiViewScorer([query([1, 0]), query([0, 1], 1, "clause:0001")], 2).score(vectors),
  ).toBeCloseTo(0.5, 6);
  expect(
    prepareMultiViewScorer([query([1, 0], 3), query([0, 1], 1, "clause:0001")], 2).score(vectors),
  ).toBeCloseTo(0.75, 6);
  expect(
    prepareMultiViewScorer([query([1, 0]), query([0.6, 0.8], 1, "clause:0001")], 2).score(vectors),
  ).toBeCloseTo(0.8, 6);
});

test("scorers have no mutable cross-call or cross-query accumulators", () => {
  const first = prepareMultiViewScorer([query([1, 0])], 2);
  const second = prepareMultiViewScorer([query([0, 1])], 2);
  const vectors = [
    document("task-card:0000", "task-card", [0.6, 0.8]),
    document("body:0000", "body", [0.2, 0.9797959]),
    document("body:0001", "body", [0.1, 0.9949874]),
  ];
  const baseline = first.score(vectors);
  second.score(vectors);
  expect(first.score([...vectors].reverse())).toBeCloseTo(baseline, 12);
  expect(first.score(vectors)).toBeCloseTo(baseline, 12);
});

test("unsupported channels, full-only inputs and malformed query vectors fail explicitly", () => {
  const scorer = prepareMultiViewScorer([query([1, 0])], 2);
  for (const vectors of [
    [document("full:0000", "full", [1, 0])],
    [document("unknown:0000", "unknown", [1, 0])],
    [],
  ]) {
    expect(() => scorer.score(vectors)).toThrow(SemanticIndexQueryError);
  }
  for (const queries of [
    [query([1, 0, 0])],
    [query([1, 0], 0)],
    [query([Number.NaN, 0])],
    [query([1, 0]), query([0, 1])],
  ]) {
    expect(() => prepareMultiViewScorer(queries, 2)).toThrow(SemanticIndexQueryError);
  }
});
