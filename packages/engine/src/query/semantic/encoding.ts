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
      // Native response decoding owns finite-value and L2 validation.
      return Float32Array.from(vector);
    }),
  );
}

/**
 * Embed inputs in order without exceeding the port's per-call limit. Every chunk is
 * validated against the expected encoding before its vectors are returned, so the
 * result has exactly one vector per input, in input order.
 */
export async function embedInBatches(
  expected: EncodingContract,
  port: EmbeddingPort,
  inputs: readonly string[],
): Promise<readonly Float32Array[]> {
  if (!Number.isSafeInteger(port.maxBatchSize) || port.maxBatchSize < 1) {
    throw new SemanticEmbeddingError("Embedding batch limit is invalid");
  }
  const vectors: Float32Array[] = [];
  for (let start = 0; start < inputs.length; start += port.maxBatchSize) {
    const batch = inputs.slice(start, start + port.maxBatchSize);
    // eslint-disable-next-line no-await-in-loop -- the Backend runtime admits one batch at a time.
    vectors.push(...validateEmbeddingBatch(expected, batch, await port.embed(batch)));
  }
  return Object.freeze(vectors);
}
