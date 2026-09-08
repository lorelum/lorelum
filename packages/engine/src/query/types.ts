import type { LocalStore, StorageRoot } from "../local-store";
import type { Practice } from "@lorelum/format";

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
}

export interface QueryService {
  query(root: StorageRoot, request: QueryRequest): Promise<QueryResult>;
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
