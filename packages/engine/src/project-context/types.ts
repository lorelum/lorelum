import type { EffectivePractice, PracticeSource, StorageRoot } from "../local-store";

export type ProjectContextState = "ready" | "degraded";

export interface ProjectPackSettings {
  readonly enabled: boolean;
  readonly priority: number;
}

export interface EffectiveProjectConfig {
  readonly base: "user" | "none";
  readonly packs: Readonly<Record<string, ProjectPackSettings>>;
}

export interface ProjectContextWarning {
  readonly code: "config.invalid" | "pack.invalid" | "practice.invalid" | "source.unsafe";
  readonly layerDepth: number;
  readonly packName?: string;
  readonly practiceId?: string;
}

export interface ContextSourceStatus {
  readonly scope: "project" | "store";
  readonly status: "active" | "shadowed" | "ignored";
  readonly layerDepth?: number;
  readonly packName: string;
  readonly practiceId?: string;
  readonly sourcePath?: string;
}

/** The in-memory result of resolving project layers against an optional Store base. */
export interface ProjectContextSnapshot {
  readonly kind: "project";
  readonly projectRootId: string;
  /** Retained only in memory for source reattachment; never cache or protocol output. */
  readonly projectRootPath: string;
  readonly layers: readonly { readonly depth: number }[];
  readonly effectiveConfig: EffectiveProjectConfig;
  readonly practices: readonly EffectivePractice[];
  readonly sources: readonly ContextSourceStatus[];
  readonly contextDigest: string;
  readonly indexCorpusDigest: string;
  readonly state: ProjectContextState;
  readonly warnings: readonly ProjectContextWarning[];
}

export interface ResolveProjectContextOptions {
  readonly store: {
    readEffectivePracticeSnapshot(root: StorageRoot): Promise<{
      readonly practices: readonly EffectivePractice[];
    }>;
  };
  readonly storageRoot: StorageRoot;
  readonly startDirectory?: string;
  readonly projectRoot?: string;
  readonly noProject?: boolean;
}

/** Explicit `--project-root` values are invalid input, unlike recoverable layer contents. */
export class InvalidProjectRootError extends Error {
  constructor() {
    super("The selected project root must be a directory containing .lorelum.");
    this.name = "InvalidProjectRootError";
  }
}

export interface ProjectPracticeCandidate {
  readonly effectivePractice: EffectivePractice;
  readonly source: PracticeSource;
  readonly layerDepth: number;
  readonly sourceKey: string;
  readonly priority: number;
}
