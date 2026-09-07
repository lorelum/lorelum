import { homedir } from "node:os";
import { join } from "node:path";

import type { ValidationIssue } from "@lorelum/format";

import type { EffectivePractice, PackCandidate, RevisionDelta } from "../model";

import { installOrUpgrade } from "./install";
import {
  openLocalStore,
  getEffectivePractice,
  readEffectivePractices as readEffectivePracticesFromStore,
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
  return { rootPath: join(homedir(), ".lorelum") };
}

export interface OpenResult {
  generation: number;
  effectiveRevision: number;
  effectivePractices: readonly EffectivePractice[];
}

export interface LocalStore {
  /** Consistent indexed point read; validates only the returned Practice and sources. */
  getEffectivePractice(
    root: StorageRoot,
    practiceId: string,
  ): Promise<EffectivePractice | undefined>;
  /** Cold open; throws StoreRecoveryRequiredError on any inconsistency. */
  open(root: StorageRoot): Promise<OpenResult>;
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
  /** Post-commit vector seam (default no-op). */
  onEffectiveRevisionAdvanced?: EffectiveRevisionHook | undefined;
}

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
    async open(root: StorageRoot): Promise<OpenResult> {
      const result = await openLocalStore(root.rootPath);
      return {
        generation: result.manifest.generation,
        effectiveRevision: result.manifest.effectiveRevision,
        effectivePractices: result.effectivePractices,
      };
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
  };
  return Object.freeze(store);
}

export type { EffectivePractice, PackCandidate, RevisionDelta };
