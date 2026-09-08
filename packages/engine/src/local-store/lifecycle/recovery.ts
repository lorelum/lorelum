import type { Database } from "bun:sqlite";

import { StoreRecoveryRequiredError } from "../storage/errors";
import {
  clearOperationJournal,
  listOperationJournals,
  readOperationJournal,
} from "../storage/journal/operation-journal";
import {
  createEmptyManifest,
  parseManifest,
  serializeManifest,
  tryReadManifest,
  writeManifest,
  type InstalledPacksManifest,
} from "../storage/manifest/manifest-store";
import { readStoreMetadata, type StoreMetadataSnapshot } from "../storage/sqlite/snapshot-reader";

export interface RecoveryResult {
  manifest: InstalledPacksManifest;
  /** undefined means a fresh store whose SQLite has never been written. */
  metadata: StoreMetadataSnapshot | undefined;
}

function tupleEquals(
  left: { generation: number; effectiveRevision: number },
  right: { generation: number; effectiveRevision: number },
): boolean {
  return left.generation === right.generation && left.effectiveRevision === right.effectiveRevision;
}

function isManifestEqual(left: InstalledPacksManifest, right: InstalledPacksManifest): boolean {
  return serializeManifest(left) === serializeManifest(right);
}

/**
 * Converge one journal record against SQLite's derived tuple (ADR 0007 §8):
 * - SQLite == journal target → publish the target manifest if it is not
 *   already active, then clear the journal.
 * - SQLite == journal old → atomically restore the old manifest, then clear.
 * - SQLite matches neither (partial commit / corrupt SQLite / single-field
 *   mismatch) → StoreRecoveryRequiredError; never expose a half state.
 */
async function reconcileJournal(
  rootPath: string,
  database: Database,
  operationId: string,
): Promise<void> {
  const record = await readOperationJournal(rootPath, operationId);
  const oldManifest = parseManifest(record.oldManifest, operationId);
  const targetManifest = parseManifest(record.targetManifest, operationId);
  const sqliteTuple = readStoreMetadata(database);

  if (sqliteTuple === undefined) {
    // SQLite was never written. The only consistent journal state is the old
    // tuple (0,0) — a fresh store with a leftover journal means the operation
    // never committed SQLite, so the old manifest is the recovery image.
    if (oldManifest.generation === 0 && oldManifest.effectiveRevision === 0) {
      await writeManifest(rootPath, oldManifest);
      await clearOperationJournal(rootPath, operationId);
      return;
    }
    throw new StoreRecoveryRequiredError(
      `journal ${operationId} targets a store that was never initialized`,
    );
  }

  const targetTuple = {
    generation: targetManifest.generation,
    effectiveRevision: targetManifest.effectiveRevision,
  };
  const oldTuple = {
    generation: oldManifest.generation,
    effectiveRevision: oldManifest.effectiveRevision,
  };

  if (tupleEquals(sqliteTuple, targetTuple)) {
    const active = await tryReadManifest(rootPath);
    if (active === undefined || !isManifestEqual(active, targetManifest)) {
      await writeManifest(rootPath, targetManifest);
    }
    await clearOperationJournal(rootPath, operationId);
    return;
  }
  if (tupleEquals(sqliteTuple, oldTuple)) {
    await writeManifest(rootPath, oldManifest);
    await clearOperationJournal(rootPath, operationId);
    return;
  }
  throw new StoreRecoveryRequiredError(
    `journal ${operationId} tuple (${sqliteTuple.generation}, ${sqliteTuple.effectiveRevision}) matches neither preimage nor target`,
  );
}

/**
 * Run the cross-medium recovery check (ADR 0007 §8): converge every leftover
 * journal record, then verify the manifest's `(generation, effectiveRevision)`
 * tuple equals SQLite's derived tuple. Throws `StoreRecoveryRequiredError` on
 * any inconsistency; returns the converged manifest and SQLite metadata.
 *
 * The caller owns the database handle (it was opened and migrated before this
 * call). Mutation entries run this under the mutation lock; cold open runs it
 * on the lock-free path.
 */
export async function runStoreRecovery(
  rootPath: string,
  database: Database,
): Promise<RecoveryResult> {
  for (const operationId of await listOperationJournals(rootPath)) {
    // eslint-disable-next-line no-await-in-loop -- each journal converges the shared store state
    await reconcileJournal(rootPath, database, operationId);
  }

  const manifest = await tryReadManifest(rootPath);
  const metadata = readStoreMetadata(database);
  if (manifest === undefined) {
    if (metadata === undefined) {
      // Fresh store: nothing was ever committed. Treat as consistent empty.
      return { manifest: createEmptyManifest(), metadata: undefined };
    }
    throw new StoreRecoveryRequiredError(
      "SQLite has committed state but the active manifest is missing",
    );
  }
  if (metadata === undefined) {
    throw new StoreRecoveryRequiredError(
      "the active manifest exists but SQLite was never committed",
    );
  }
  if (
    !tupleEquals(metadata, {
      generation: manifest.generation,
      effectiveRevision: manifest.effectiveRevision,
    })
  ) {
    throw new StoreRecoveryRequiredError(
      `manifest tuple (${manifest.generation}, ${manifest.effectiveRevision}) differs from SQLite tuple (${metadata.generation}, ${metadata.effectiveRevision})`,
    );
  }
  return { manifest, metadata };
}
