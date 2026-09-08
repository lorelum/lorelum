import { rm } from "node:fs/promises";

import { removePackSources } from "../model";
import { artifactPath } from "../storage/artifacts/artifact-store";
import {
  clearOperationJournal,
  createOperationJournalRecord,
  writeOperationJournal,
} from "../storage/journal/operation-journal";
import { writeManifest, type InstalledPacksManifest } from "../storage/manifest/manifest-store";
import {
  materializeEffectivePracticesByIds,
  readPracticeIdsForPack,
} from "../storage/sqlite/snapshot-reader";
import { applyIncrementalDerivedState } from "../storage/sqlite/state-writer";

import { PackNotInstalledError } from "./errors";
import { nextStoreCounter } from "./counters";
import { activeSources, deliverRevisionNotifications, withStoreMutation } from "./mutation";
import type { MutationMetricsObserver } from "../storage/sqlite/mutation-metrics";
import type { EffectiveRevisionHook, UninstallResult } from "./types";

function withoutPack(
  manifest: InstalledPacksManifest,
  packName: string,
  effectiveRevision: number,
): InstalledPacksManifest {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    generation: nextStoreCounter(manifest.generation, "generation"),
    effectiveRevision,
    packs: Object.freeze(manifest.packs.filter((pack) => pack.packName !== packName)),
  });
}

/**
 * Uninstall one pack (ADR 0007 §7, 定稿 §6). The pack's sources are removed;
 * an Effective Practice survives while another pack still provides it, and is
 * deleted when its last source goes away. Deleting a pack that is not active
 * throws `PackNotInstalledError` — never silent success.
 */
export async function uninstallPack(
  rootPath: string,
  packName: string,
  hook: EffectiveRevisionHook | undefined,
  metrics?: MutationMetricsObserver,
): Promise<UninstallResult> {
  const committed = await withStoreMutation(rootPath, async ({ database, recovery }) => {
    const active = recovery.manifest;
    const entry = active.packs.find((pack) => pack.packName === packName);
    if (entry === undefined) throw new PackNotInstalledError(packName);

    const affectedPracticeIds = readPracticeIdsForPack(database, packName);
    const effectivePractices =
      recovery.metadata === undefined
        ? []
        : materializeEffectivePracticesByIds(database, recovery.metadata, affectedPracticeIds);
    metrics?.recordRead("practice_sources", affectedPracticeIds.length);
    metrics?.recordRead("effective_practices", effectivePractices.length);
    const sourceRows = effectivePractices.reduce(
      (count, practice) => count + practice.sources.length,
      0,
    );
    metrics?.recordRead("practice_sources", sourceRows);
    metrics?.recordMaterialization(effectivePractices.length, sourceRows);
    const reconciled = removePackSources(activeSources(effectivePractices), packName);

    const advances = reconciled.advancesEffectiveRevision;
    const targetManifest = withoutPack(
      active,
      packName,
      advances
        ? nextStoreCounter(active.effectiveRevision, "effectiveRevision")
        : active.effectiveRevision,
    );

    const journal = createOperationJournalRecord("uninstall", active, targetManifest);
    await writeOperationJournal(rootPath, journal);
    await writeManifest(rootPath, targetManifest);
    applyIncrementalDerivedState(
      database,
      {
        generation: targetManifest.generation,
        effectiveRevision: targetManifest.effectiveRevision,
        activePacks: targetManifest.packs,
        effectivePractices: reconciled.effectivePractices,
        affectedPracticeIds,
        activePackMutation: { kind: "remove", packName },
        revisionNotification:
          advances && hook !== undefined ? { delta: reconciled.delta } : undefined,
        revisionLogDelta: advances ? reconciled.delta : undefined,
      },
      metrics,
    );

    await clearOperationJournal(rootPath, journal.operationId);

    // Post-commit GC: the removed pack's artifact is no longer referenced.
    let cleanupPending = false;
    try {
      await rm(artifactPath(rootPath, entry.storageKey, entry.artifactDigest), {
        recursive: true,
        force: true,
      });
    } catch {
      cleanupPending = true;
    }

    return Object.freeze({
      generation: targetManifest.generation,
      effectiveRevision: targetManifest.effectiveRevision,
      delta: reconciled.delta,
      diagnostics: Object.freeze([]),
      cleanupPending,
    });
  }, { metrics });
  const notificationPending = await deliverRevisionNotifications(
    rootPath,
    hook,
    committed.effectiveRevision,
  );
  return Object.freeze({ ...committed, notificationPending });
}
