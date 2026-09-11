import { isAbsolute } from "node:path";
import { z } from "zod";
import { BackendError } from "../protocol/errors";

export const MAX_SERIALIZED_EMBEDDING_BYTES = 2_048;

/** The only model setting accepted by the local backend in this stage. */
export const embeddingConfigSchema = z
  .strictObject({
    modelPath: z.string().min(1).refine(isAbsolute),
  })
  .refine(
    (snapshot) =>
      Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MAX_SERIALIZED_EMBEDDING_BYTES,
  );
export type EmbeddingConfig = Readonly<z.infer<typeof embeddingConfigSchema>>;

/** Resolve an already-read shared-config section into an immutable snapshot. */
export function resolveEmbeddingConfig(source: unknown): EmbeddingConfig | undefined {
  if (source === undefined) return undefined;
  const result = embeddingConfigSchema.safeParse(source);
  if (!result.success) throw new BackendError("backend.config-invalid");
  return Object.freeze(result.data);
}
