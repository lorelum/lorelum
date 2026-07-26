import type { AntiPattern, PackInput, Practice, ValidationReport } from "@lorelum/format";

export interface StorageRoot {
  readonly path: string;
}

export interface SnapshotFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface PreparedPack {
  readonly input: PackInput;
  readonly files: readonly SnapshotFile[];
  readonly practiceSourcePaths: ReadonlyMap<string, string>;
}

export interface SnapshotCodec {
  decode(artifactDirectory: string): Promise<PreparedPack>;
}

export interface InstalledPack {
  readonly name: string;
  readonly version: string;
  readonly artifactDigest: string;
  readonly storageKey: string;
  readonly installedAt: string;
}

export interface EffectivePractice {
  readonly id: string;
  readonly title: string;
  readonly stage: string;
  readonly techStack: readonly string[];
  readonly appliesWhen: string;
  readonly severity: NonNullable<Practice["severity"]>;
  readonly body: string;
  readonly antiPatterns: readonly AntiPattern[];
  readonly canonicalContent: string;
  readonly contentDigest: string;
  readonly effectiveRevision: number;
  readonly sourcePackNames: readonly string[];
}

export interface LocalStoreState {
  readonly installedPacksGeneration: number;
  readonly effectiveRevision: number;
}

export interface LocalStoreOpenOptions {
  readonly root?: StorageRoot;
}

export interface InstallResult {
  readonly kind: "installed" | "upgraded" | "unchanged";
  readonly pack: InstalledPack;
  readonly effectiveRevision: number;
  readonly validation: ValidationReport;
}

export interface UninstallResult {
  readonly packName: string;
  readonly effectiveRevision: number;
}
