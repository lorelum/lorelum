import { expect, test } from "bun:test";
import { embedInBatches, type EmbeddingPort } from "./encoding";
import { SemanticEmbeddingError } from "./errors";

const encodingId = "c".repeat(64);
const expected = { encodingId, dimensions: 2 };

/** Unit vector whose angle is the input text, so a misordered vector is visible. */
function angleVector(text: string): number[] {
  const angle = Number(text) / 10;
  return [Math.cos(angle), Math.sin(angle)];
}

/** Mirrors the Backend limit: a single embed call may not carry more than `limit` inputs. */
function limitedPort(limit: number, calls: number[]): EmbeddingPort {
  return {
    maxBatchSize: limit,
    async embed(inputs) {
      calls.push(inputs.length);
      if (inputs.length > limit) throw new Error("embedding.input-invalid");
      return { encodingId, vectors: inputs.map(angleVector) };
    },
  };
}

test("inputs beyond one call are split so no call exceeds the port limit, preserving order", async () => {
  const calls: number[] = [];
  const inputs = Array.from({ length: 9 }, (_, index) => String(index));
  const vectors = await embedInBatches(expected, limitedPort(8, calls), inputs);
  expect(calls).toEqual([8, 1]);
  expect(vectors).toHaveLength(9);
  inputs.forEach((text, index) => {
    expect(vectors[index]![0]).toBeCloseTo(Math.cos(Number(text) / 10), 5);
    expect(vectors[index]![1]).toBeCloseTo(Math.sin(Number(text) / 10), 5);
  });
});

test("a port limit of one embeds each input in its own call", async () => {
  const calls: number[] = [];
  const vectors = await embedInBatches(expected, limitedPort(1, calls), ["0", "1", "2"]);
  expect(calls).toEqual([1, 1, 1]);
  expect(vectors).toHaveLength(3);
});

test("an empty input list makes no embed call", async () => {
  const calls: number[] = [];
  await expect(embedInBatches(expected, limitedPort(8, calls), [])).resolves.toEqual([]);
  expect(calls).toEqual([]);
});

test("a non-positive or non-integer port limit is rejected before any call", async () => {
  for (const maxBatchSize of [0, -1, 1.5]) {
    const calls: number[] = [];
    await expect(
      embedInBatches(expected, { ...limitedPort(8, calls), maxBatchSize }, ["0"]),
    ).rejects.toBeInstanceOf(SemanticEmbeddingError);
    expect(calls).toEqual([]);
  }
});
