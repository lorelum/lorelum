import { resolveLorelumPaths } from "@lorelum/config";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { BackendError } from "../protocol/errors";

export const DEFAULT_MODEL_DOWNLOAD_URL =
  "https://huggingface.co/Lorelum/granite-embedding-97m-multilingual-r2-GGUF/resolve/7a8af1473a747268bbb3968b77d5b822a6506667/granite-q4_0.gguf";

export const MAX_SERIALIZED_EMBEDDING_BYTES = 2_048;
export const DEFAULT_EMBEDDING_SETTINGS = Object.freeze({ threads: 4 });
const absolutePath = z.string().min(1).refine(isAbsolute);
const sourceUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
const downloadSchema = z.strictObject({
  enabled: z.boolean().default(true),
  url: sourceUrl.default(DEFAULT_MODEL_DOWNLOAD_URL),
  connectTimeoutSeconds: z.int().min(1).max(300).default(30),
  stallTimeoutSeconds: z.int().min(1).max(3600).default(60),
  maxAttempts: z.int().min(1).max(10).default(3),
});
export const embeddingConfigSchema = z
  .strictObject({
    modelPath: absolutePath.optional(),
    cacheDirectory: absolutePath.optional(),
    threads: z.int().min(1).max(64).default(DEFAULT_EMBEDDING_SETTINGS.threads),
    download: downloadSchema.prefault({}),
  })
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SERIALIZED_EMBEDDING_BYTES,
  );
export type EmbeddingConfig = Readonly<z.input<typeof embeddingConfigSchema>>;
export type ResolvedEmbeddingConfig = Readonly<
  z.output<typeof embeddingConfigSchema> & { cacheDirectory: string }
>;

/** Resolve once at launch; services consume this immutable snapshot, never environment/files. */
export function resolveEmbeddingConfig(
  source: unknown,
  homeDirectory = homedir(),
): ResolvedEmbeddingConfig {
  const result = embeddingConfigSchema.safeParse(source === undefined ? {} : source);
  if (!result.success) throw new BackendError("backend.config-invalid");
  const value = {
    ...result.data,
    cacheDirectory:
      result.data.cacheDirectory ??
      join(resolveLorelumPaths(homeDirectory).rootDirectory, "models"),
  };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SERIALIZED_EMBEDDING_BYTES)
    throw new BackendError("backend.config-invalid");
  return Object.freeze({ ...value, download: Object.freeze(value.download) });
}
