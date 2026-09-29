import { z } from "zod";

export const embeddingErrorCodes = [
  "embedding.preparation-expired",
  "embedding.not-configured",
  "embedding.download-unavailable",
  "embedding.download-failed",
  "embedding.download-stalled",
  "embedding.download-range-unsupported",
  "embedding.resource-invalid",
  "embedding.native-resource-invalid",
  "embedding.not-loaded",
  "embedding.busy",
  "embedding.input-invalid",
  "embedding.deadline-exceeded",
  "embedding.failed",
] as const;
export type EmbeddingErrorCode = (typeof embeddingErrorCodes)[number];
export const resourceFailureSchema = z.strictObject({
  kind: z.enum(["model", "native"]),
  file: z
    .string()
    .regex(
      /^(?:native\/(?:darwin-arm64|linux-x64|win32-x64)\/[A-Za-z0-9_.-]+|model\.gguf(?:\.part)?|embedding\.modelPath)$/,
    ),
  check: z.enum(["missing", "invalid", "size-mismatch", "sha256-mismatch", "manifest-mismatch"]),
  expected: z
    .string()
    .regex(/^(?:[a-f0-9]{64}|[0-9]+)$/)
    .optional(),
  actual: z
    .string()
    .regex(/^(?:[a-f0-9]{64}|[0-9]+)$/)
    .optional(),
});
export type ResourceFailure = z.infer<typeof resourceFailureSchema>;
const messages: Record<EmbeddingErrorCode, string> = {
  "embedding.preparation-expired":
    "The local model preparation is no longer available; retry the query.",
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
    "The fixed embedding model is invalid. Correct the configured model file or cache, then retry `lore model load`.",
  "embedding.native-resource-invalid":
    "The installed native runtime is missing or invalid. Reinstall the matching complete CLI build; reloading the model will not repair it.",
  "embedding.not-loaded": "Load the embedding model before encoding text.",
  "embedding.busy":
    "The embedding model is busy; wait for the current preparation, unload, or encoding operation to finish.",
  "embedding.input-invalid": "Provide one to eight nonblank texts.",
  "embedding.deadline-exceeded": "The embedding operation exceeded its deadline.",
  "embedding.failed": "The embedding runtime failed; explicitly load it again after cleanup.",
};
export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    options?: ErrorOptions,
    readonly resource?: ResourceFailure,
  ) {
    super(resource === undefined ? messages[code] : resourceMessage(code, resource), options);
    this.name = "EmbeddingError";
  }
}

function resourceMessage(code: EmbeddingErrorCode, resource: ResourceFailure): string {
  const subject = resource.kind === "native" ? "Native runtime file" : "Fixed model file";
  const detail =
    resource.check === "missing"
      ? "is missing"
      : resource.check === "size-mismatch"
        ? `has size ${resource.actual ?? "unknown"}; expected ${resource.expected ?? "unknown"}`
        : resource.check === "sha256-mismatch"
          ? `has SHA-256 ${resource.actual ?? "unknown"}; expected ${resource.expected ?? "unknown"}`
          : resource.check === "manifest-mismatch"
            ? "does not match this CLI build"
            : "failed validation";
  const recovery =
    code === "embedding.native-resource-invalid"
      ? "Reinstall the matching complete CLI build; reloading the model will not repair it."
      : resource.file === "embedding.modelPath"
        ? "Correct embedding.modelPath and retry `lore model load`."
        : "Replace the invalid fixed model file and retry `lore model load`.";
  return `${subject} ${resource.file} ${detail}. ${recovery}`;
}
export function embeddingFailure(error: unknown): EmbeddingError {
  return error instanceof EmbeddingError ? error : new EmbeddingError("embedding.failed");
}
