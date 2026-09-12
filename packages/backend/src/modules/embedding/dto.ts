import { z } from "zod";
import { EMBEDDING_MODEL, modelStates } from "./model";
import { embeddingErrorCodes } from "./errors";

export const emptyModelRequestSchema = z.strictObject({});
export const modelProgressSchema = z.strictObject({
  phase: z.enum(["resolving", "downloading", "verifying", "starting"]),
  downloadedBytes: z.int().nonnegative().optional(),
  totalBytes: z.int().positive().optional(),
  attempt: z.int().positive().optional(),
});
export type ModelProgress = z.infer<typeof modelProgressSchema>;
const encodingIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const modelStatusSchema = z.strictObject({
  state: z.enum(modelStates),
  encodingId: encodingIdSchema,
  device: z.literal("cpu"),
  dimensions: z.literal(EMBEDDING_MODEL.dimensions),
  error: z.enum(embeddingErrorCodes).optional(),
  threads: z.int().min(1).max(64),
  progress: modelProgressSchema.optional(),
});
export type ModelStatus = z.infer<typeof modelStatusSchema>;
export const embeddingRequestSchema = z.strictObject({
  kind: z.enum(["query", "document"]),
  inputs: z
    .array(z.string().refine((text) => text.trim().length > 0))
    .min(1)
    .max(EMBEDDING_MODEL.maxInputs),
});
export const embeddingVectorSchema = z
  .array(z.number().finite())
  .length(EMBEDDING_MODEL.dimensions)
  .refine(
    (vector) =>
      Math.abs(Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) - 1) < 0.001,
  );
export const embeddingResultSchema = z.strictObject({
  encodingId: encodingIdSchema,
  vectors: z.array(embeddingVectorSchema).min(1).max(EMBEDDING_MODEL.maxInputs),
});
