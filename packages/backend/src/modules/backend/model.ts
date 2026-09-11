import { z } from "zod";
import { modelStates } from "../embedding/model";

export const identitySchema = z.strictObject({
  instanceId: z.string().min(1).max(128),
  buildIdentity: z.string().min(1).max(128),
  controlVersion: z.int(),
  businessVersion: z.int(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BackendIdentity = z.infer<typeof identitySchema>;
export const backendStatusStates = ["starting", "ready", "stopping", "stopped"] as const;
export const statusSchema = z.strictObject({
  state: z.enum(backendStatusStates),
  model: z.enum(modelStates),
  instanceId: z.string().optional(),
  buildIdentity: z.string().optional(),
});
export type BackendStatus = z.infer<typeof statusSchema>;

export const identityQuerySchema = z.strictObject({
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
});
