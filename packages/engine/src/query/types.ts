import type { LocalStore, StorageRoot } from "../local-store";
import type { Practice } from "@lorelum/format";
import type { LogEmitter, TraceId } from "@lorelum/log";

export interface QueryRequest {
  readonly text: string;
  readonly limit?: number;
}

export interface QueryHit {
  readonly practiceId: string;
  readonly title: string;
  readonly stage: string;
  readonly techStack: readonly string[];
  readonly appliesWhen: string;
  readonly severity: NonNullable<Practice["severity"]>;
  readonly contentDigest: string;
}

export interface QueryResult {
  readonly mode: "keyword";
  readonly results: readonly QueryHit[];
  readonly emptyReason?: "corpus-empty";
}

export interface QueryService {
  query(
    root: StorageRoot,
    request: QueryRequest,
    diagnostics?: KeywordQueryDiagnostics,
  ): Promise<QueryResult>;
}

/** Optional, caller-scoped signals keep Engine independent of process I/O. */
export interface KeywordQueryDiagnostics {
  readonly emitter: LogEmitter;
  readonly traceId?: TraceId;
}

export interface QueryDependencies {
  readonly store: Pick<
    LocalStore,
    | "readSnapshotIdentity"
    | "readEffectivePracticeSnapshot"
    | "readEffectivePracticeChanges"
    | "readEffectivePracticesAtSnapshot"
  >;
}
