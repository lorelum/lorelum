import { SemanticEmbeddingError } from "./errors";

export interface EncodingContract {
  readonly encodingId: string;
  readonly dimensions: number;
}

export interface EmbeddingBatch {
  readonly encodingId: string;
  readonly vectors: readonly (readonly number[])[];
}

/** Runtime capability injected by the Backend host; Engine never imports its implementation. */
export interface EmbeddingPort {
  readonly maxBatchSize: number;
  embed(inputs: readonly string[]): Promise<EmbeddingBatch>;
}

export function assertEncodingContract(value: EncodingContract): void {
  if (!/^[a-f0-9]{64}$/.test(value.encodingId)) {
    throw new SemanticEmbeddingError("Embedding encoding identity is invalid");
  }
  if (!Number.isSafeInteger(value.dimensions) || value.dimensions < 1) {
    throw new SemanticEmbeddingError("Embedding dimensions are invalid");
  }
}

export function validateEmbeddingBatch(
  expected: EncodingContract,
  inputs: readonly string[],
  batch: EmbeddingBatch,
): readonly Float32Array[] {
  assertEncodingContract(expected);
  if (batch.encodingId !== expected.encodingId) {
    throw new SemanticEmbeddingError("Embedding encoding identity changed during operation");
  }
  if (batch.vectors.length !== inputs.length) {
    throw new SemanticEmbeddingError("Embedding result count differs from input count");
  }
  return Object.freeze(
    batch.vectors.map((vector) => {
      if (vector.length !== expected.dimensions) {
        throw new SemanticEmbeddingError("Embedding vector dimensions are invalid");
      }
      const values = Float32Array.from(vector);
      let squaredLength = 0;
      for (const value of values) {
        if (!Number.isFinite(value))
          throw new SemanticEmbeddingError("Embedding vector is not finite");
        squaredLength += value * value;
      }
      if (Math.abs(Math.sqrt(squaredLength) - 1) >= 0.001) {
        throw new SemanticEmbeddingError("Embedding vector is not L2-normalized");
      }
      return values;
    }),
  );
}
