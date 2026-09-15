import { isAbsolute } from "node:path";
import { z } from "zod";

import { embeddingErrorCodes } from "../embedding/errors";

// The store root must be explicit and absolute; the separator convention is the host's
// (mirrors query/model.ts — Windows drive roots are not slash-prefixed).
const storageRootSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "storageRoot must be an absolute path");
const profileIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const projectContextSchema = z.strictObject({
  projectRoot: z.string().min(1).refine(isAbsolute, "projectRoot must be an absolute path"),
  cacheRoot: z.string().min(1).refine(isAbsolute, "cacheRoot must be an absolute path"),
});
export type ProjectIndexRequest = z.infer<typeof projectContextSchema>;

export const indexStateSchema = z.enum(["missing", "indexing", "ready", "stale", "incompatible"]);
const indexProgressSchema = {
  indexedPracticeCount: z.int().nonnegative().optional(),
  totalPracticeCount: z.int().nonnegative().optional(),
};
export const indexStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.enum(["missing", "stale", "incompatible"]),
    profileId: profileIdSchema,
    vectorCount: z.int().nonnegative().optional(),
  }),
  z.strictObject({
    state: z.literal("indexing"),
    profileId: profileIdSchema,
    operationId: z.string().uuid(),
    ...indexProgressSchema,
  }),
  z.strictObject({
    state: z.literal("ready"),
    profileId: profileIdSchema,
    vectorCount: z.int().nonnegative().optional(),
  }),
]);
export type IndexStatus = z.infer<typeof indexStatusSchema>;

export const indexStatusQuerySchema = z
  .strictObject({
    storageRoot: storageRootSchema,
    projectRoot: projectContextSchema.shape.projectRoot.optional(),
    cacheRoot: projectContextSchema.shape.cacheRoot.optional(),
  })
  .refine(
    (value) => value.projectRoot === undefined || value.cacheRoot !== undefined,
    "projectRoot requires cacheRoot",
  );
export const indexMutationSchema = z
  .strictObject({
    storageRoot: storageRootSchema,
    projectContext: projectContextSchema.optional(),
    cacheRoot: projectContextSchema.shape.cacheRoot.optional(),
  })
  .refine(
    (value) => value.projectContext === undefined || value.cacheRoot === undefined,
    "projectContext carries its cacheRoot",
  );
export const indexOperationStateSchema = z.enum([
  "waiting-for-source",
  "queued",
  "building",
  "preparing",
  "ready",
  "failed",
]);
export const indexOperationStoreErrorCodes = ["store.busy", "store.recovery-required"] as const;
export const indexOperationErrorCodes = [
  "backend.failed",
  ...embeddingErrorCodes,
  ...indexOperationStoreErrorCodes,
] as const;
export type IndexOperationErrorCode = (typeof indexOperationErrorCodes)[number];
const indexOperationIdSchema = z.string().uuid();
export const indexOperationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    operationId: indexOperationIdSchema,
    state: z.literal("waiting-for-source"),
    ...indexProgressSchema,
  }),
  z.strictObject({
    operationId: indexOperationIdSchema,
    state: z.literal("queued"),
    ...indexProgressSchema,
  }),
  z.strictObject({
    operationId: indexOperationIdSchema,
    state: z.literal("building"),
    ...indexProgressSchema,
  }),
  z.strictObject({
    operationId: indexOperationIdSchema,
    state: z.literal("preparing"),
    preparationId: z.string().uuid(),
    ...indexProgressSchema,
  }),
  z.strictObject({
    operationId: indexOperationIdSchema,
    state: z.literal("ready"),
    index: indexStatusSchema,
  }),
  z.strictObject({
    operationId: indexOperationIdSchema,
    state: z.literal("failed"),
    error: z.enum(indexOperationErrorCodes),
  }),
]);
export type IndexOperation = z.infer<typeof indexOperationSchema>;
export const indexOperationParamsSchema = z.strictObject({ operationId: z.string().uuid() });
