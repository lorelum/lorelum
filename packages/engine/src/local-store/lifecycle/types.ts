import type { ValidationIssue } from "@lorelum/format";

import type { RevisionDelta } from "../model";

/** The committed tuple + diagnostics shared by every mutation result (ADR 0007 §13). */
export interface MutationResultBase {
  generation: number;
  effectiveRevision: number;
  delta: RevisionDelta;
  /** Non-blocking validatePack warnings/infos surfaced for the CLI. */
  diagnostics: readonly ValidationIssue[];
  /** True when post-commit artifact cleanup failed and is retryable later. */
  cleanupPending: boolean;
  /** Oldest durable outbox row still awaiting vector-hook delivery. */
  notificationPending?: { revision: number; error: unknown } | undefined;
}

export interface InstallResult extends MutationResultBase {
  /** Digest of the canonical sealed Pack artifact active after the operation. */
  artifactDigest: string;
  /** True when the candidate matched the already-active artifact digest. */
  idempotent: boolean;
}

export interface UninstallResult extends MutationResultBase {}

export interface ReindexResult extends MutationResultBase {}

/** Post-commit vector seam (ADR 0007 §4): default no-op, serial in revision order. */
export type EffectiveRevisionHook = (
  revision: number,
  delta: RevisionDelta,
) => void | Promise<void>;
