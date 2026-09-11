import { z } from "zod";
import { EMBEDDING_MODEL, ENCODING_ID, modelStates } from "./model";
import { embeddingErrorCodes } from "./errors";

export const emptyModelRequestSchema = z.strictObject({});
export const modelStatusSchema = z.strictObject({
  state: z.enum(modelStates),
  encodingId: z.literal(ENCODING_ID),
  device: z.literal("cpu"),
  dimensions: z.literal(EMBEDDING_MODEL.dimensions),
  error: z.enum(embeddingErrorCodes).optional(),
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
  encodingId: z.literal(ENCODING_ID),
  vectors: z.array(embeddingVectorSchema).min(1).max(EMBEDDING_MODEL.maxInputs),
});
