import type { EffectivePractice, InstalledPackSummary, StorageRoot } from "../local-store/index.js";

export type ListedPractice = Readonly<
  Pick<EffectivePractice["practice"], "id" | "title" | "applies_when">
>;

export interface ListedPack {
  readonly name: string;
  readonly version: string;
  readonly practiceCount: number;
}

export interface RetrievePacksInput {
  readonly packs: readonly InstalledPackSummary[];
  readonly effectivePractices: readonly EffectivePractice[];
}

export interface RetrievePackPracticesInput {
  readonly packName: string;
  readonly packs: readonly InstalledPackSummary[];
  readonly effectivePractices: readonly EffectivePractice[];
}

export interface RetrievePacksResult {
  readonly packs: readonly ListedPack[];
}

export interface RetrievePackPracticesResult {
  readonly pack: InstalledPackSummary;
  readonly practices: readonly ListedPractice[];
}

export interface ListRequest {
  /** Per-call LocalStore root override; omitted uses the service default. */
  readonly storageRoot?: StorageRoot;
}

export interface ListPackRequest {
  readonly packName: string;
  /** Per-call LocalStore root override; omitted uses the service default. */
  readonly storageRoot?: StorageRoot;
}

export interface ListPacksResult extends RetrievePacksResult {
  readonly generation: number;
  readonly effectiveRevision: number;
}

export interface ListPackPracticesResult extends RetrievePackPracticesResult {
  readonly generation: number;
  readonly effectiveRevision: number;
}
