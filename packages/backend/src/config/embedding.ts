import { resolveLorelumPaths } from "@lorelum/config";
import type { ConfigFailure, ConfigRule, ConfigSource } from "@lorelum/config";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { backendConfigError } from "./failure";

export const DEFAULT_MODEL_DOWNLOAD_URL =
  "https://huggingface.co/Lorelum/granite-embedding-97m-multilingual-r2-GGUF/resolve/7a8af1473a747268bbb3968b77d5b822a6506667/granite-q4_0.gguf";

export const MAX_SERIALIZED_EMBEDDING_BYTES = 2_048;
export const DEFAULT_EMBEDDING_SETTINGS = Object.freeze({ threads: 4 });
export const EMBEDDING_LIMITS = Object.freeze({
  threads: Object.freeze({ minimum: 1, maximum: 64 }),
  connectTimeoutSeconds: Object.freeze({ minimum: 1, maximum: 300 }),
  stallTimeoutSeconds: Object.freeze({ minimum: 1, maximum: 3_600 }),
  maxAttempts: Object.freeze({ minimum: 1, maximum: 10 }),
});
const absolutePath = z.string().min(1).refine(isAbsolute);
const sourceUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
});
const downloadSchema = z.strictObject({
  enabled: z.boolean().default(true),
  url: sourceUrl.default(DEFAULT_MODEL_DOWNLOAD_URL),
  connectTimeoutSeconds: z
    .int()
    .min(EMBEDDING_LIMITS.connectTimeoutSeconds.minimum)
    .max(EMBEDDING_LIMITS.connectTimeoutSeconds.maximum)
    .default(30),
  stallTimeoutSeconds: z
    .int()
    .min(EMBEDDING_LIMITS.stallTimeoutSeconds.minimum)
    .max(EMBEDDING_LIMITS.stallTimeoutSeconds.maximum)
    .default(60),
  maxAttempts: z
    .int()
    .min(EMBEDDING_LIMITS.maxAttempts.minimum)
    .max(EMBEDDING_LIMITS.maxAttempts.maximum)
    .default(3),
});
const embeddingFieldsSchema = z.strictObject({
  modelPath: absolutePath.optional(),
  cacheDirectory: absolutePath.optional(),
  threads: z
    .int()
    .min(EMBEDDING_LIMITS.threads.minimum)
    .max(EMBEDDING_LIMITS.threads.maximum)
    .default(DEFAULT_EMBEDDING_SETTINGS.threads),
  download: downloadSchema.prefault({}),
});
export const embeddingConfigSchema = embeddingFieldsSchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SERIALIZED_EMBEDDING_BYTES,
);
export type EmbeddingConfig = Readonly<z.input<typeof embeddingConfigSchema>>;
export type ResolvedEmbeddingConfig = Readonly<
  z.output<typeof embeddingConfigSchema> & { cacheDirectory: string }
>;

function issueSubject(issue: z.ZodIssue): string {
  const [section, field] = issue.path;
  let path: string[];
  if (section === undefined) {
    path = [];
  } else if (
    typeof section === "string" &&
    Object.hasOwn(embeddingFieldsSchema.shape, section) &&
    (issue.path.length === 1 ||
      (section === "download" &&
        issue.path.length === 2 &&
        typeof field === "string" &&
        Object.hasOwn(downloadSchema.shape, field)))
  ) {
    path = issue.path.map((segment) => segment as string);
  } else {
    return "embedding section";
  }

  if (issue.code === "unrecognized_keys") {
    const [unknownKey] = issue.keys;
    if (unknownKey !== undefined) path.push(unknownKey);
  }
  return path.length === 0 ? "embedding section" : `embedding.${path.join(".")}`;
}

function issueReason(issue: z.ZodIssue): Extract<ConfigFailure, { kind: "setting" }>["reason"] {
  if (issue.code === "unrecognized_keys") return "unknown-key";
  if (issue.code === "invalid_type") return "type";
  if (issue.code === "too_big" || issue.code === "too_small") return "range";
  if (issue.code === "custom" && issue.path.length === 0) return "size";
  if (issue.code === "invalid_value") return "enum";
  return "format";
}

function issueRule(issue: z.ZodIssue): ConfigRule | undefined {
  if (issue.code === "unrecognized_keys") return undefined;
  if (issue.code === "custom" && issue.path.length === 0) {
    return { kind: "max-bytes", maximum: MAX_SERIALIZED_EMBEDDING_BYTES };
  }

  const [section, field] = issue.path;
  if (issue.code === "invalid_type" && issue.path.length === 0) {
    return { kind: "shape", expected: "object" };
  }
  if (issue.code === "invalid_type" && section === "download" && issue.path.length === 1) {
    return { kind: "shape", expected: "object" };
  }
  if (issue.path.length === 1 && (section === "modelPath" || section === "cacheDirectory")) {
    return { kind: "non-empty-absolute-path" };
  }
  if (issue.path.length === 1 && section === "threads") {
    return {
      kind: "integer",
      minimum: EMBEDDING_LIMITS.threads.minimum,
      maximum: EMBEDDING_LIMITS.threads.maximum,
    };
  }
  if (section === "download" && typeof field === "string" && issue.path.length === 2) {
    if (field === "enabled") return { kind: "shape", expected: "boolean" };
    if (field === "url") return { kind: "https-url-without-credentials-or-fragment" };
    if (
      field === "connectTimeoutSeconds" ||
      field === "stallTimeoutSeconds" ||
      field === "maxAttempts"
    ) {
      const limits = EMBEDDING_LIMITS[field];
      return { kind: "integer", minimum: limits.minimum, maximum: limits.maximum };
    }
  }
  return undefined;
}

function invalidEmbedding(source: ConfigSource, issues: readonly z.ZodIssue[]): never {
  const issue = issues[0];
  const rule = issue === undefined ? undefined : issueRule(issue);
  const failure: ConfigFailure = {
    kind: "setting",
    source,
    subject: issue === undefined ? "embedding section" : issueSubject(issue),
    reason: issue === undefined ? "format" : issueReason(issue),
    ...(rule === undefined ? {} : { rule }),
  };
  throw backendConfigError(failure);
}

/** Resolve once at launch; services consume this immutable snapshot, never environment/files. */
export function resolveEmbeddingConfig(
  source: unknown,
  homeDirectory = homedir(),
  configSource: ConfigSource = { kind: "resolved", label: "Backend embedding settings" },
): ResolvedEmbeddingConfig {
  const result = embeddingConfigSchema.safeParse(source === undefined ? {} : source);
  if (!result.success) invalidEmbedding(configSource, result.error.issues);
  const value = {
    ...result.data,
    cacheDirectory:
      result.data.cacheDirectory ??
      join(resolveLorelumPaths(homeDirectory).rootDirectory, "models"),
  };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SERIALIZED_EMBEDDING_BYTES) {
    throw backendConfigError({
      kind: "setting",
      source: {
        kind: "resolved",
        label: "resolved embedding settings after applying the cache path default",
      },
      subject: "embedding section",
      reason: "size",
      rule: { kind: "max-bytes", maximum: MAX_SERIALIZED_EMBEDDING_BYTES },
    });
  }
  return Object.freeze({ ...value, download: Object.freeze(value.download) });
}
