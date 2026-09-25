import type { LogContext, TraceId } from "./context.js";
import type { ManagedLogLocationFailure } from "./sinks/safety.js";
import type { LogEventInput, LogRecord } from "./record.js";
import type { ManagedLogRoot } from "./reader.js";
import type { TraceLogCollection } from "./trace.js";

/** Message identifying the per-invocation persistence outcome record. */
export const PERSISTENCE_MESSAGE = "log.persistence";

/**
 * Why a designed log location could not be used, as persisted with a trace.
 * The sink-side union is the single vocabulary; the outcome record and the
 * protocol envelope carry it unchanged.
 */
export type PersistenceFailureFact = ManagedLogLocationFailure;

/** A permission tightening that happened before evidence was written. */
export interface PersistenceRepairFact {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly beforeMode: number;
  readonly afterMode: number;
}

/**
 * The facts one invocation persists about its own diagnostics persistence.
 * Written only when the invocation deviated from the quiet normal path.
 * `usedPath` says where evidence actually went and is meaningful when
 * `persisted` is true; the attempt paths record what was tried, including
 * attempts that failed.
 */
export interface PersistenceOutcomeFact {
  /** Whether this invocation's diagnostic records were actually persisted. */
  readonly persisted: boolean;
  readonly fallbackUsed: boolean;
  readonly attemptedPath: string;
  readonly usedPath: string;
  /** Present when the designed fallback was tried, whether or not it worked. */
  readonly fallbackAttemptPath?: string;
  readonly failure?: PersistenceFailureFact;
  readonly repairs?: readonly PersistenceRepairFact[];
}

/** Builds the record a runtime appends when its persistence deviated. */
export function persistenceRecordInput(
  traceId: TraceId,
  source: string,
  fact: PersistenceOutcomeFact,
): LogEventInput {
  return {
    level: "info",
    source,
    message: PERSISTENCE_MESSAGE,
    traceId,
    context: { ...fact } as LogContext,
  };
}

function asFact(record: LogRecord): PersistenceOutcomeFact | undefined {
  if (record.message !== PERSISTENCE_MESSAGE) return undefined;
  const context = record.context as Partial<PersistenceOutcomeFact> | undefined;
  if (
    context === undefined ||
    typeof context.persisted !== "boolean" ||
    typeof context.fallbackUsed !== "boolean" ||
    typeof context.attemptedPath !== "string" ||
    typeof context.usedPath !== "string"
  ) {
    return undefined;
  }
  return context as PersistenceOutcomeFact;
}

export type TraceEvidenceStatus =
  | "available"
  | "not-persisted"
  | "no-matching-records"
  | "unreadable"
  | "truncated";

/** The one trace-bound evidence state every viewing entrypoint must share. */
export interface TraceEvidenceState {
  readonly traceId: TraceId;
  readonly status: TraceEvidenceStatus;
  /** Which designed roots hold this trace's records (deduplicated). */
  readonly roots: readonly ManagedLogRoot[];
  readonly missingEvidence: readonly string[];
}

function hasRootLevelGap(missing: readonly string[]): boolean {
  return missing.some(
    (marker) => marker === "log-root-unavailable" || marker === "fallback:log-root-unavailable",
  );
}

function hasUnreadableFiles(missing: readonly string[]): boolean {
  return missing.some(
    (marker) =>
      marker.startsWith("log-file-unreadable:") ||
      marker.startsWith("fallback:log-file-unreadable:"),
  );
}

/** The collection fields the derivation needs; any dual-root read can supply them. */
export type TraceEvidenceInput = Pick<
  TraceLogCollection,
  "traceId" | "directRecords" | "directLocations" | "missing" | "truncated" | "rootAvailability"
>;

/**
 * Derives the canonical evidence state for one trace from a dual-root
 * collection. It never infers a write failure without a persisted outcome
 * record saying so: an unknown trace stays "no-matching-records".
 */
export function deriveTraceEvidenceState(collection: TraceEvidenceInput): TraceEvidenceState {
  const locations: ManagedLogRoot[] = [];
  let persistedEvidence = false;
  let notPersistedFact = false;
  for (let index = 0; index < collection.directRecords.length; index += 1) {
    const record = collection.directRecords[index]!;
    const fact = asFact(record);
    if (fact === undefined) {
      persistedEvidence = true;
      locations.push(collection.directLocations[index] ?? "primary");
    } else if (fact.persisted === false) {
      notPersistedFact = true;
    }
  }

  const missingEvidence = new Set(collection.missing);
  let status: TraceEvidenceStatus;
  if (persistedEvidence) {
    status = "available";
  } else if (notPersistedFact) {
    status = "not-persisted";
    missingEvidence.add("evidence-not-persisted");
  } else if (hasRootLevelGap(collection.missing)) {
    // A root-level gap means the primary evidence store itself could not be
    // read; a readable fallback only proves evidence elsewhere, not that this
    // trace has none, so the state stays "unreadable".
    status = "unreadable";
  } else if (hasUnreadableFiles(collection.missing)) {
    status = "unreadable";
  } else if (collection.truncated) {
    status = "truncated";
  } else {
    status = "no-matching-records";
    missingEvidence.add("no-matching-records");
  }
  return {
    traceId: collection.traceId,
    status,
    roots: [...new Set(locations)],
    missingEvidence: [...missingEvidence],
  };
}
