import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EffectivePractice } from "../../local-store";
import { canonicalizePractice } from "../../local-store/model";
import {
  createVectorExecution,
  resolveVectorRetrievalMethod,
  VECTOR_RETRIEVAL_METHOD_IDS,
} from "../semantic";
import { readSharedEmbeddingVectors, writeSharedEmbeddingVectors } from "./vector-cache";

const encodingId = "d".repeat(64);
const methodIds = [...VECTOR_RETRIEVAL_METHOD_IDS];

function practice(id: string, text: string): EffectivePractice {
  return {
    practiceId: id,
    ...canonicalizePractice({
      id,
      title: text,
      stage: "implementation",
      tech_stack: ["typescript"],
      applies_when: "When caching document embeddings.",
      body: text,
    }),
    sources: [],
  };
}

async function withCache(run: (cache: string) => Promise<void>): Promise<void> {
  const cache = await mkdtemp(join(tmpdir(), "lorelum-vector-cache-"));
  try {
    await run(cache);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

test.each(methodIds)(
  "shared cache addresses inputs by content rather than a Practice-local key (%s)",
  async (methodId) => {
    await withCache(async (cache) => {
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      const original = execution.method.projectDocument(
        practice("platform.first", "Original guidance."),
      );
      const changed = execution.method.projectDocument(
        practice("platform.first", "Revised guidance."),
      );
      const second = execution.method.projectDocument(
        practice("platform.second", "Separate guidance."),
      );
      const originalKeys = original.inputs.map((input) => input.inputKey);
      expect(changed.inputs.map((input) => input.inputKey)).toEqual(originalKeys);
      expect(second.inputs.map((input) => input.inputKey)).toEqual(originalKeys);
      await writeSharedEmbeddingVectors(
        cache,
        execution.profile,
        original.inputs,
        original.inputs.map(() => new Float32Array([1, 0])),
      );
      expect(
        (await readSharedEmbeddingVectors(cache, execution.profile, changed.inputs)).size,
      ).toBe(0);
      expect((await readSharedEmbeddingVectors(cache, execution.profile, second.inputs)).size).toBe(
        0,
      );
      await writeSharedEmbeddingVectors(
        cache,
        execution.profile,
        second.inputs,
        second.inputs.map(() => new Float32Array([0, 1])),
      );
      const firstVectors = await readSharedEmbeddingVectors(
        cache,
        execution.profile,
        original.inputs,
      );
      const secondVectors = await readSharedEmbeddingVectors(
        cache,
        execution.profile,
        second.inputs,
      );
      expect(original.inputs.map((input) => firstVectors.get(input.inputDigest))).toEqual(
        original.inputs.map(() => new Float32Array([1, 0])),
      );
      expect(second.inputs.map((input) => secondVectors.get(input.inputDigest))).toEqual(
        second.inputs.map(() => new Float32Array([0, 1])),
      );
    });
  },
);

test("shared cache keeps method profiles isolated even for the same requested input digest", async () => {
  await withCache(async (cache) => {
    const single = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("single-vector"),
    );
    const multi = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    const inputs = single.method.projectDocument(
      practice("platform.first", "Profile-isolated guidance."),
    ).inputs;
    await writeSharedEmbeddingVectors(
      cache,
      single.profile,
      inputs,
      inputs.map(() => new Float32Array([1, 0])),
    );
    expect((await readSharedEmbeddingVectors(cache, multi.profile, inputs)).size).toBe(0);
    await writeSharedEmbeddingVectors(
      cache,
      multi.profile,
      inputs,
      inputs.map(() => new Float32Array([0, 1])),
    );
    expect(
      [...(await readSharedEmbeddingVectors(cache, single.profile, inputs))].map(
        ([, vector]) => vector,
      ),
    ).toEqual(inputs.map(() => new Float32Array([1, 0])));
    expect(
      [...(await readSharedEmbeddingVectors(cache, multi.profile, inputs))].map(
        ([, vector]) => vector,
      ),
    ).toEqual(inputs.map(() => new Float32Array([0, 1])));
  });
});
