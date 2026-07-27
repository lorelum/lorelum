import type { Pack, Practice } from "@lorelum/format";

/** Deeply frozen snapshot retained after canonicalization. */
export type PracticeSnapshot = Readonly<
  Omit<Practice, "tech_stack" | "anti_patterns"> & {
    tech_stack: readonly string[];
    anti_patterns?: readonly Readonly<NonNullable<Practice["anti_patterns"]>[number]>[];
  }
>;

export type PackSnapshot = Readonly<
  Omit<Pack, "applies_to" | "depends_on"> & {
    applies_to?: readonly string[];
    depends_on?: readonly string[];
  }
>;

/** A Practice plus the deterministic representation used for merge decisions. */
export interface CanonicalPractice {
  practice: PracticeSnapshot;
  canonicalContent: string;
  contentDigest: string;
}

/** One Pack's claim to a Practice. Source paths are Pack-root-relative POSIX paths. */
export interface PracticeSource {
  packName: string;
  practiceId: string;
  contentDigest: string;
  sourcePath: string;
  canonicalPractice: CanonicalPractice;
}

/** The deduplicated Practice presented to the future retrieval layer. */
export interface EffectivePractice {
  practiceId: string;
  contentDigest: string;
  canonicalContent: string;
  practice: PracticeSnapshot;
  sources: readonly PracticeSource[];
}

/** A format-valid Pack ready for the storage/lifecycle layer to install. */
export interface PackCandidate {
  pack: PackSnapshot;
  sources: readonly PracticeSource[];
}

/** Changes to Effective Practices resulting from one source-set reconciliation. */
export interface RevisionDelta {
  added: readonly string[];
  changed: readonly string[];
  invalidated: readonly string[];
}

export interface ReconciledPractices {
  sources: readonly PracticeSource[];
  effectivePractices: readonly EffectivePractice[];
  delta: RevisionDelta;
  advancesEffectiveRevision: boolean;
}
