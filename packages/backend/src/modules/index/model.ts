import { z } from "zod";

import { embeddingErrorCodes } from "../embedding/errors";

const storageRootSchema = z.string().min(1).regex(/^\//);
const profileIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const indexStateSchema = z.enum(["missing", "ready", "stale", "incompatible"]);
export const indexStatusSchema = z.strictObject({
  state: indexStateSchema,
  profileId: profileIdSchema,
  vectorCount: z.int().nonnegative().optional(),
});
export type IndexStatus = z.infer<typeof indexStatusSchema>;

export const indexStatusQuerySchema = z.strictObject({ storageRoot: storageRootSchema });
export const indexMutationSchema = z.strictObject({ storageRoot: storageRootSchema });
export const indexOperationStateSchema = z.enum(["building", "ready", "failed"]);
export const indexOperationStoreErrorCodes = ["store.busy", "store.recovery-required"] as const;
export const indexOperationErrorCodes = [
  "backend.failed",
  ...embeddingErrorCodes,
  ...indexOperationStoreErrorCodes,
] as const;
export type IndexOperationErrorCode = (typeof indexOperationErrorCodes)[number];
export const indexOperationSchema = z.strictObject({
  operationId: z.string().uuid(),
  state: indexOperationStateSchema,
  index: indexStatusSchema.optional(),
  error: z.enum(indexOperationErrorCodes).optional(),
});
export type IndexOperation = z.infer<typeof indexOperationSchema>;
export const indexOperationParamsSchema = z.strictObject({ operationId: z.string().uuid() });
