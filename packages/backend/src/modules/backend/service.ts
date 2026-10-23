import { constantTimeEqual, identityProof, type InstanceIdentity } from "../../protocol/identity";
import type { BackendStatus } from "./model";
import type { BuildInfo } from "../../protocol/build-provenance";
import type { RuntimeActivityAssessment } from "../../runtime/activity-state";

export interface BackendServiceOptions {
  readonly identity: InstanceIdentity;
  readonly build: BuildInfo;
  readonly secret: string;
  readonly isReady?: () => boolean;
  readonly modelState?: () => BackendStatus["model"];
  /** Runs the v4 runtime-activity check and writes handoff-stop only when idle. */
  readonly onTryBeginIdleStop?: () => Promise<RuntimeActivityAssessment>;
  readonly onStop: () => void | Promise<void>;
  readonly onStopFailure?: (error: unknown) => void;
}

type RuntimeBackendStatus = Extract<BackendStatus, { state: "starting" | "ready" | "stopping" }>;

/** Owns this daemon's admission and stop state; no HTTP Context or process discovery. */
export function createBackendService(options: BackendServiceOptions) {
  if (!options.secret) throw new TypeError("Backend secret must not be empty");
  // Select public fields explicitly: structural types may carry private runtime fields.
  const { instanceId, buildIdentity, protocolVersion } = options.identity;
  const identity = Object.freeze({ instanceId, buildIdentity, protocolVersion });
  const build = Object.freeze({
    toolVersion: options.build.toolVersion,
    revision: options.build.revision,
    dirty: options.build.dirty,
    buildKind: options.build.buildKind,
  });
  let stopping = false;
  let permanentStopRequested = false;
  let activeBusinessRequests = 0;
  let idleStopAttempt: Promise<IdleStopResult> | undefined;
  let shutdown: Promise<void> | undefined;
  const available = () => !stopping && (options.isReady?.() ?? true);
  const status = (): RuntimeBackendStatus => ({
    state: stopping ? "stopping" : available() ? "ready" : "starting",
    model: options.modelState?.() ?? "unloaded",
    instanceId,
    buildIdentity,
    backendProtocolVersion: protocolVersion,
    build,
  });
  return {
    authenticate: (credential: string) => constantTimeEqual(credential, options.secret),
    available,
    status,
    admitBusinessRequest() {
      if (!available()) return undefined;
      activeBusinessRequests++;
      return () => {
        activeBusinessRequests--;
      };
    },
    identify: (nonce: string) => ({
      ...identity,
      proof: identityProof(options.secret, nonce, identity),
    }),
    beginStop() {
      permanentStopRequested = true;
      stopping = true;
      return status();
    },
    async tryBeginIdleStop(): Promise<IdleStopResult> {
      if (permanentStopRequested || (stopping && idleStopAttempt === undefined)) {
        return { state: "accepted", status: status() };
      }
      if (idleStopAttempt !== undefined) return idleStopAttempt;

      // Close admission and inspect the count in one synchronous turn. No accepted
      // request can appear between these two operations.
      stopping = true;
      if (activeBusinessRequests > 0) {
        stopping = false;
        return { state: "deferred", reason: "active-long-task" };
      }

      const attempt = (async (): Promise<IdleStopResult> => {
        try {
          const assessment = await (options.onTryBeginIdleStop?.() ??
            Promise.resolve({ state: "unknown", reason: "unknown-activity" } as const));
          if (assessment.state !== "idle") {
            if (permanentStopRequested) return { state: "accepted", status: status() };
            stopping = false;
            return { state: "deferred", reason: assessment.reason };
          }
          return { state: "accepted", status: status() };
        } catch (error) {
          if (!permanentStopRequested) stopping = false;
          throw error;
        }
      })();
      idleStopAttempt = attempt;
      try {
        return await attempt;
      } finally {
        if (idleStopAttempt === attempt) idleStopAttempt = undefined;
      }
    },
    stop(): Promise<void> {
      permanentStopRequested = true;
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

export type IdleStopResult =
  | { readonly state: "accepted"; readonly status: RuntimeBackendStatus }
  | {
      readonly state: "deferred";
      readonly reason: "active-long-task" | "unknown-activity";
    };
