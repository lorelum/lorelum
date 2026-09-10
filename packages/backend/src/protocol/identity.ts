import { createHmac, timingSafeEqual } from "node:crypto";
import type { BackendIdentity } from "../modules/backend/model";

export type InstanceIdentity = Omit<BackendIdentity, "proof">;
export function identityProof(secret: string, nonce: string, identity: InstanceIdentity): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        nonce,
        identity.instanceId,
        identity.buildIdentity,
        identity.controlVersion,
        identity.businessVersion,
      ]),
    )
    .digest("hex");
}
export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
