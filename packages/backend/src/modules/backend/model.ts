import { z } from "zod";
import { modelStates } from "../embedding/model";
import { BuildProvenanceSchema } from "../../protocol/build-provenance";

export const identitySchema = z.strictObject({
  instanceId: z.string().min(1).max(128),
  buildIdentity: z.string().min(1).max(128),
  protocolVersion: z.int(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BackendIdentity = z.infer<typeof identitySchema>;
export const backendStatusStates = ["starting", "ready", "stopping", "stopped"] as const;
const runningStatusSchema = z.strictObject({
  state: z.enum(["starting", "ready", "stopping"]),
  model: z.enum(modelStates),
  instanceId: z.string().min(1).max(128),
  buildIdentity: z.string().min(1).max(128),
  backendProtocolVersion: z.int(),
  build: BuildProvenanceSchema,
});
const stoppedStatusSchema = z.strictObject({
  state: z.literal("stopped"),
  model: z.literal("unloaded"),
});
export const statusSchema = z.discriminatedUnion("state", [
  runningStatusSchema,
  stoppedStatusSchema,
]);
export type BackendStatus = z.infer<typeof statusSchema>;

export const identityQuerySchema = z.strictObject({
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
});

export const stopRequestSchema = z.union([
  z.undefined(),
  z.strictObject({ ifIdle: z.literal(true).optional() }),
]);

export const deferredStopSchema = z.strictObject({
  state: z.literal("deferred"),
  reason: z.enum(["active-long-task", "unknown-activity"]),
});
export const stopResponseSchema = z.union([statusSchema, deferredStopSchema]);
export type StopResponse = z.infer<typeof stopResponseSchema>;
