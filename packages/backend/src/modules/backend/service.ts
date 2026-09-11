import { constantTimeEqual, identityProof, type InstanceIdentity } from "../../protocol/identity";
import type { BackendStatus } from "./model";

export interface BackendServiceOptions {
  readonly identity: InstanceIdentity;
  readonly secret: string;
  readonly isReady?: () => boolean;
  readonly modelState?: () => BackendStatus["model"];
  readonly onStop: () => void | Promise<void>;
  readonly onStopFailure?: (error: unknown) => void;
}

/** Owns this daemon's admission and stop state; no HTTP Context or process discovery. */
export function createBackendService(options: BackendServiceOptions) {
  if (!options.secret) throw new TypeError("Backend secret must not be empty");
  // Select public fields explicitly: structural types may carry private runtime fields.
  const { instanceId, buildIdentity, controlVersion, businessVersion } = options.identity;
  const identity = Object.freeze({ instanceId, buildIdentity, controlVersion, businessVersion });
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  const available = () => !stopping && (options.isReady?.() ?? true);
  const status = (): BackendStatus => ({
    state: stopping ? "stopping" : available() ? "ready" : "starting",
    model: options.modelState?.() ?? "unloaded",
    instanceId,
    buildIdentity,
  });
  return {
    authenticate: (credential: string) => constantTimeEqual(credential, options.secret),
    available,
    status,
    identify: (nonce: string) => ({
      ...identity,
      proof: identityProof(options.secret, nonce, identity),
    }),
    beginStop() {
      stopping = true;
      return status();
    },
    stop(): Promise<void> {
      stopping = true;
      shutdown ??= Promise.resolve()
        .then(options.onStop)
        .catch((error) => {
          if (options.onStopFailure) options.onStopFailure(error);
          else console.error("Local backend lifecycle stop callback failed");
        });
      return shutdown;
    },
  };
}
export type BackendService = ReturnType<typeof createBackendService>;
