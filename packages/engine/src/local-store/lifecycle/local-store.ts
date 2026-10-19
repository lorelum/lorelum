import { resolveLorelumPaths } from "@lorelum/config";

import type { ValidationIssue } from "@lorelum/format";

import type { EffectivePractice, PackCandidate, RevisionDelta } from "../model";
import { toInstalledPackDetails, type InstalledPackDetails } from "../model/pack-details";

import { installOrUpgrade } from "./install";
import {
  openLocalStore,
  getEffectivePractice,
  getEffectivePracticeWithPackRoots,
  readEffectivePracticeChanges,
  readEffectivePracticeSnapshot,
  readEffectivePracticesAtSnapshot,
  readEffectivePractices as readEffectivePracticesFromStore,
  readSnapshotIdentity,
  withSnapshotFence,
  type EffectivePracticeChangeSnapshot,
  type EffectivePracticeSnapshot,
  type EffectivePracticeSourceLocator,
  type EffectivePracticeWithPackRoots,
  type StoreSnapshotIdentity,
} from "./open";
import { reindexStore } from "./reindex";
import { uninstallPack } from "./uninstall";
import type { EffectiveRevisionHook, InstallResult, ReindexResult, UninstallResult } from "./types";

/** Injectable storage root; defaults to `~/.lorelum/` (ADR 0007 §6). */
export interface StorageRoot {
  readonly rootPath: string;
}

/** Resolve the default user-level storage root. */
export function defaultStorageRoot(): StorageRoot {
  return { rootPath: resolveLorelumPaths().rootDirectory };
}

export interface OpenResult {
  readonly generation: number;
  readonly effectiveRevision: number;
  readonly packs: readonly InstalledPackSummary[];
  readonly effectivePractices: readonly EffectivePractice[];
}

/** The public projection of one active manifest Pack entry. */
export interface InstalledPackSummary {
  readonly name: string;
  readonly version: string;
  readonly packRoot: string;
}

export interface InstalledPackDetailsResult {
  readonly generation: number;
  readonly effectiveRevision: number;
  readonly packs: readonly InstalledPackDetails[];
}

export interface LocalStore {
  /** Consistent indexed point read; validates only the returned Practice and sources. */
  getEffectivePractice(
    root: StorageRoot,
    practiceId: string,
  ): Promise<EffectivePractice | undefined>;
  /** Point read with source-scoped current locators from the same committed snapshot. */
  getEffectivePracticeWithPackRoots(
    root: StorageRoot,
    practiceId: string,
  ): Promise<EffectivePracticeWithPackRoots | undefined>;
  /** Cold open; throws StoreRecoveryRequiredError on any inconsistency. */
  open(root: StorageRoot): Promise<OpenResult>;
  /** Verified Pack metadata and locators from sealed projections. */
  readInstalledPackDetails(root: StorageRoot): Promise<InstalledPackDetailsResult>;
  install(
    root: StorageRoot,
    candidate: PackCandidate,
    diagnostics?: readonly ValidationIssue[],
  ): Promise<InstallResult>;
  upgrade(
    root: StorageRoot,
    candidate: PackCandidate,
    diagnostics?: readonly ValidationIssue[],
  ): Promise<InstallResult>;
  uninstall(root: StorageRoot, packName: string): Promise<UninstallResult>;
  /** Recovery entry; bypasses open() (ADR 0007 §8). */
  reindex(root: StorageRoot): Promise<ReindexResult>;
  /** Lock-free read path: consistent (manifest, SQLite) Effective Practice materialization. */
  readEffectivePractices(root: StorageRoot): Promise<readonly EffectivePractice[]>;
  /** Verified lightweight identity for a query index checkpoint. */
  readSnapshotIdentity(root: StorageRoot): Promise<StoreSnapshotIdentity>;
  /** Verified complete corpus and the identity that produced it. */
  readEffectivePracticeSnapshot(root: StorageRoot): Promise<EffectivePracticeSnapshot>;
  /** Verified contiguous deltas after a query-index checkpoint, or undefined when unavailable. */
  readEffectivePracticeChanges(
    root: StorageRoot,
    afterEffectiveRevision: number,
  ): Promise<EffectivePracticeChangeSnapshot | undefined>;
  /** Verified bounded current rows for a query result at one expected Store snapshot. */
  readEffectivePracticesAtSnapshot(
    root: StorageRoot,
    expected: StoreSnapshotIdentity,
    ids: readonly string[],
  ): Promise<readonly EffectivePractice[]>;
  /** Publish prepared derived state only if this Store identity remains current. */
  withSnapshotFence<T>(
    root: StorageRoot,
    expected: StoreSnapshotIdentity,
    publish: () => Promise<T>,
  ): Promise<T>;
  /** Post-commit vector seam (default no-op). */
  onEffectiveRevisionAdvanced?: EffectiveRevisionHook | undefined;
}

export type { InstalledPackDetails } from "../model/pack-details";

/**
 * The LocalStore public facade (ADR 0007 §13). Cross-medium commit ordering
 * lives only in lifecycle/; model/ stays pure and storage/ only reads and
 * writes media. The optional hook drains a durable outbox serially after each
 * committed mutation in monotonically increasing effectiveRevision order.
 */
export function createLocalStore(
  options: { onEffectiveRevisionAdvanced?: EffectiveRevisionHook } = {},
): LocalStore {
  const hook = options.onEffectiveRevisionAdvanced;
  const store: LocalStore = {
    getEffectivePractice(root, practiceId) {
      return getEffectivePractice(root.rootPath, practiceId);
    },
    getEffectivePracticeWithPackRoots(root, practiceId) {
      return getEffectivePracticeWithPackRoots(root.rootPath, practiceId);
    },
    async open(root: StorageRoot): Promise<OpenResult> {
      const result = await openLocalStore(root.rootPath);
      return {
        generation: result.manifest.generation,
        effectiveRevision: result.manifest.effectiveRevision,
        packs: Object.freeze(
          result.packDetails.map(({ pack, packRoot }) =>
            Object.freeze({ name: pack.name, version: pack.version, packRoot }),
          ),
        ),
        effectivePractices: result.effectivePractices,
      };
    },
    async readInstalledPackDetails(root: StorageRoot): Promise<InstalledPackDetailsResult> {
      const result = await openLocalStore(root.rootPath);
      const packs = result.packDetails.map(({ pack, packRoot }) =>
        toInstalledPackDetails({ ...pack, packRoot }),
      );
      return Object.freeze({
        generation: result.manifest.generation,
        effectiveRevision: result.manifest.effectiveRevision,
        packs: Object.freeze(packs),
      });
    },
    install(
      root: StorageRoot,
      candidate: PackCandidate,
      diagnostics?: readonly ValidationIssue[],
    ): Promise<InstallResult> {
      return installOrUpgrade(root.rootPath, candidate, "install", hook, diagnostics);
    },
    upgrade(
      root: StorageRoot,
      candidate: PackCandidate,
      diagnostics?: readonly ValidationIssue[],
    ): Promise<InstallResult> {
      return installOrUpgrade(root.rootPath, candidate, "upgrade", hook, diagnostics);
    },
    uninstall(root: StorageRoot, packName: string): Promise<UninstallResult> {
      return uninstallPack(root.rootPath, packName, hook);
    },
    reindex(root: StorageRoot): Promise<ReindexResult> {
      return reindexStore(root.rootPath, hook);
    },
    readEffectivePractices(root: StorageRoot): Promise<readonly EffectivePractice[]> {
      return readEffectivePracticesFromStore(root.rootPath);
    },
    readSnapshotIdentity(root: StorageRoot): Promise<StoreSnapshotIdentity> {
      return readSnapshotIdentity(root.rootPath);
    },
    readEffectivePracticeSnapshot(root: StorageRoot): Promise<EffectivePracticeSnapshot> {
      return readEffectivePracticeSnapshot(root.rootPath);
    },
    readEffectivePracticeChanges(
      root: StorageRoot,
      afterEffectiveRevision: number,
    ): Promise<EffectivePracticeChangeSnapshot | undefined> {
      return readEffectivePracticeChanges(root.rootPath, afterEffectiveRevision);
    },
    readEffectivePracticesAtSnapshot(
      root: StorageRoot,
      expected: StoreSnapshotIdentity,
      ids: readonly string[],
    ): Promise<readonly EffectivePractice[]> {
      return readEffectivePracticesAtSnapshot(root.rootPath, expected, ids);
    },
    withSnapshotFence(root, expected, publish) {
      return withSnapshotFence(root.rootPath, expected, publish);
    },
  };
  return Object.freeze(store);
}

export type {
  EffectivePractice,
  EffectivePracticeChangeSnapshot,
  EffectivePracticeSnapshot,
  EffectivePracticeSourceLocator,
  EffectivePracticeWithPackRoots,
  PackCandidate,
  RevisionDelta,
  StoreSnapshotIdentity,
};
