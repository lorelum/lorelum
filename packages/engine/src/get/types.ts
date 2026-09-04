import type { StorageRoot } from "../local-store/lifecycle/local-store.js";
import type { EffectivePractice } from "../local-store/model/types.js";
import type { PracticeSourceResult } from "../retrieval/types.js";

/** Practice fields returned by `get`, matching the canonical LocalStore snapshot. */
export type GetPractice = Readonly<
  Pick<
    EffectivePractice["practice"],
    "id" | "title" | "stage" | "tech_stack" | "applies_when" | "severity" | "body" | "anti_patterns"
  >
>;

/** The get-specific projection of one resolved Practice. */
export interface GetPracticeResult {
  readonly practice: GetPractice;
  /** Every active LocalStore source claim, in deterministic source order. */
  readonly sources: readonly PracticeSourceResult[];
}

export interface GetRequest {
  /** Dotted Practice id (ADR 0003 §5); `lore get` resolves exactly one id. */
  readonly practiceId: string;
  /** Per-call LocalStore root override; omitted uses the service default. */
  readonly storageRoot?: StorageRoot;
}

export interface GetResult extends GetPracticeResult {
  readonly generation: number;
  readonly effectiveRevision: number;
}
