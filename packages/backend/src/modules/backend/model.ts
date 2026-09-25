import { z } from "zod";
import { modelStates } from "../embedding/model";

export const identitySchema = z.strictObject({
  instanceId: z.string().min(1).max(128),
  buildIdentity: z.string().min(1).max(128),
  protocolVersion: z.int(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BackendIdentity = z.infer<typeof identitySchema>;
export const backendStatusStates = ["starting", "ready", "stopping", "stopped"] as const;
export const diagnosticsPersistenceStates = ["enabled", "degraded"] as const;
export const statusSchema = z.strictObject({
  state: z.enum(backendStatusStates),
  model: z.enum(modelStates),
  instanceId: z.string().optional(),
  buildIdentity: z.string().optional(),
  /** How this daemon's own diagnostics persistence fared at startup. */
  diagnostics: z
    .strictObject({
      persistence: z.enum(diagnosticsPersistenceStates),
      usedDirectory: z.string().optional(),
      fallbackUsed: z.boolean(),
      failureCategory: z.string().optional(),
    })
    .optional(),
});
export type BackendStatus = z.infer<typeof statusSchema>;

export const identityQuerySchema = z.strictObject({
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
});
