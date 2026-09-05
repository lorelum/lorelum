import type { StorageRoot } from "../local-store/lifecycle/local-store.js";
import type { EffectivePractice } from "../local-store/model/types.js";

type QueryPracticeSnapshot = EffectivePractice["practice"];

export type RetrievedPractice = Readonly<
  Pick<QueryPracticeSnapshot, "id" | "title" | "stage" | "tech_stack" | "applies_when">
>;

/** Pure retrieval input; no filesystem, Store, or CLI concerns. */
export interface RetrievePracticesInput {
  readonly effectivePractices: readonly EffectivePractice[];
  readonly query: string;
  /** Result cap; default 5, defensively clamped to 1..50. */
  readonly topK?: number;
}

export interface RetrievedPractices {
  readonly query: string;
  readonly k: number;
  /** Count of all matches before `k` truncation; v1 does not paginate. */
  readonly total: number;
  readonly results: readonly RetrievedPractice[];
}

export interface QueryRequest {
  readonly query: string;
  /** Result cap; default 5, defensively clamped to 1..50. */
  readonly topK?: number;
  /** Per-call LocalStore root override; omitted uses the service default. */
  readonly storageRoot?: StorageRoot;
}

export interface QueryResult extends RetrievedPractices {
  readonly generation: number;
  readonly effectiveRevision: number;
}
