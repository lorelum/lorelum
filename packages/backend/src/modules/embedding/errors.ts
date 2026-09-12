export const embeddingErrorCodes = [
  "embedding.not-configured",
  "embedding.download-unavailable",
  "embedding.download-failed",
  "embedding.download-stalled",
  "embedding.download-range-unsupported",
  "embedding.resource-invalid",
  "embedding.not-loaded",
  "embedding.busy",
  "embedding.input-invalid",
  "embedding.deadline-exceeded",
  "embedding.failed",
] as const;
export type EmbeddingErrorCode = (typeof embeddingErrorCodes)[number];
const messages: Record<EmbeddingErrorCode, string> = {
  "embedding.download-unavailable":
    "No download source is configured for the fixed model. Configure embedding.download.url or modelPath.",
  "embedding.download-failed":
    "The model download failed. Partial data was retained; load again to resume.",
  "embedding.download-stalled":
    "The model download stopped making progress. Partial data was retained; load again to resume.",
  "embedding.download-range-unsupported":
    "The server cannot resume this partial download. Use a Range-capable mirror; partial data was retained.",
  "embedding.not-configured":
    "Configure embedding.modelPath and restart the backend before loading the model.",
  "embedding.resource-invalid":
    "The fixed embedding model or native runtime is missing or does not match its manifest.",
  "embedding.not-loaded": "Load the embedding model before encoding text.",
  "embedding.busy": "The embedding model is busy.",
  "embedding.input-invalid": "Provide one to eight nonblank texts.",
  "embedding.deadline-exceeded": "The embedding operation exceeded its deadline.",
  "embedding.failed": "The embedding runtime failed; explicitly load it again after cleanup.",
};
export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    options?: ErrorOptions,
  ) {
    super(messages[code], options);
    this.name = "EmbeddingError";
  }
}
export function embeddingFailure(error: unknown): EmbeddingError {
  return error instanceof EmbeddingError ? error : new EmbeddingError("embedding.failed");
}
