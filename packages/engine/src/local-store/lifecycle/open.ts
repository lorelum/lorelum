import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { ID_REGEX } from "@lorelum/format";

import {
  revisionDeltaPracticeIds,
  type EffectivePractice,
  type PackSnapshot,
  type RevisionDelta,
} from "../model";
import { artifactPath, calculateArtifactDigest } from "../storage/artifacts/artifact-store";
import {
  parseProjection,
  PROJECTION_RELATIVE_PATH,
  type SnapshotProjection,
} from "../storage/artifacts/projection";
import {
  LocalStoreStorageError,
  SqliteStateError,
  StoreBusyError,
  StoreRecoveryRequiredError,
} from "../storage/errors";
import {
  createEmptyManifest,
  installedPackEntriesEqual,
  serializeManifest,
  tryReadManifest,
  type InstalledPacksManifest,
} from "../storage/manifest/manifest-store";
import {
  acquireMutationLock,
  isMutationLockHeld,
  reclaimStaleMutationLock,
} from "../storage/mutation-lock";
import { listOperationJournals } from "../storage/journal/operation-journal";
import { openStoreDatabase } from "../storage/sqlite/database";
import {
  readLocalStoreSnapshot,
  readStoreMetadata,
  readActivePackEntries,
  materializeEffectivePractices,
  materializeEffectivePracticesByIds,
  type StoreMetadataSnapshot,
} from "../storage/sqlite/snapshot-reader";
import { readPractice } from "../storage/sqlite/practice-reader";
import { readEffectiveRevisionLog } from "../storage/sqlite/revision-log";
import { InvalidPracticeIdError, StoreSnapshotChangedError } from "./errors";

import { runStoreRecovery } from "./recovery";
import { withStoreMutation } from "./mutation";

/* eslint-disable no-await-in-loop -- consistency and recovery retries are intentionally sequential */

/**
 * Internal cold-open result: the converged manifest plus materialized
 * practices and verified Pack metadata. The public facade maps this to the exported `OpenResult`
 * (ADR 0007 §13), keeping the manifest type out of the public surface.
 */
export interface ColdOpenResult {
  manifest: InstalledPacksManifest;
  packDetails: readonly PackSnapshot[];
  effectivePractices: readonly EffectivePractice[];
}

/** A verified Store snapshot identity used to bind a derived query index. */
export interface StoreSnapshotIdentity {
  readonly rootBinding: string;
  readonly generation: number;
  readonly effectiveRevision: number;
  readonly manifestDigest: string;
}

export interface EffectivePracticeSnapshot {
  readonly identity: StoreSnapshotIdentity;
  readonly practices: readonly EffectivePractice[];
}

export interface EffectivePracticeChange {
  readonly revision: number;
  readonly delta: RevisionDelta;
}

export interface EffectivePracticeChangeSnapshot {
  readonly identity: StoreSnapshotIdentity;
  readonly deltas: readonly EffectivePracticeChange[];
  readonly currentPractices: readonly EffectivePractice[];
}

interface ConsistentSnapshot<T> {
  readonly manifest: InstalledPacksManifest;
  readonly metadata: StoreMetadataSnapshot | undefined;
  readonly value: T;
}

const MAX_OPEN_RETRIES = 3;

/** ADR 0007 §8: cold open reports every inconsistency as recovery required. */
function translateStoreErrors(error: unknown): never {
  if (error instanceof StoreRecoveryRequiredError || error instanceof StoreBusyError) throw error;
  if (error instanceof SqliteStateError) {
    throw new StoreRecoveryRequiredError(`SQLite is missing or corrupt: ${error.message}`);
  }
  if (error instanceof LocalStoreStorageError) {
    throw new StoreRecoveryRequiredError(error.message);
  }
  throw error;
}

/** Open + migrate SQLite, mapping storage errors to the recovery contract. */
async function openStoreForLifecycle(
  rootPath: string,
): Promise<Awaited<ReturnType<typeof openStoreDatabase>>> {
  try {
    return await openStoreDatabase(rootPath);
  } catch (error) {
    return translateStoreErrors(error);
  }
}

function manifestsEqual(
  left: InstalledPacksManifest | undefined,
  right: InstalledPacksManifest | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return serializeManifest(left) === serializeManifest(right);
}

async function readSealedProjection(artifactDir: string): Promise<SnapshotProjection> {
  let text: string;
  try {
    text = await readFile(join(artifactDir, PROJECTION_RELATIVE_PATH), "utf8");
  } catch {
    throw new StoreRecoveryRequiredError(`cannot read sealed projection for ${artifactDir}`);
  }
  return parseProjection(text, artifactDir);
}

async function verifyArtifactsAndSources(
  rootPath: string,
  manifest: InstalledPacksManifest,
  effectivePractices: readonly EffectivePractice[],
): Promise<readonly PackSnapshot[]> {
  const expectedSources = new Map<string, { digest: string }>();
  const packDetails = await Promise.all(
    manifest.packs.map(async (entry) => {
      const artifactDir = artifactPath(rootPath, entry.storageKey, entry.artifactDigest);
      const artifactDigest = await calculateArtifactDigest(artifactDir);
      if (artifactDigest !== entry.artifactDigest) {
        throw new StoreRecoveryRequiredError(`artifact digest mismatch for ${entry.storageKey}`);
      }
      const projection = await readSealedProjection(artifactDir);
      if (
        projection.pack.name !== entry.packName ||
        projection.pack.version !== entry.packVersion
      ) {
        throw new StoreRecoveryRequiredError(
          `projection metadata differs from the manifest for ${entry.storageKey}`,
        );
      }
      for (const practice of projection.practices) {
        expectedSources.set(`${entry.packName}/${practice.sourcePath}`, {
          digest: practice.contentDigest,
        });
      }
      return projection.pack;
    }),
  );

  for (const practice of effectivePractices) {
    for (const source of practice.sources) {
      const key = `${source.packName}/${source.sourcePath}`;
      const expected = expectedSources.get(key);
      if (expected === undefined || expected.digest !== source.contentDigest) {
        throw new StoreRecoveryRequiredError(
          `source ${key} does not reconcile with any sealed projection`,
        );
      }
      expectedSources.delete(key);
    }
  }
  if (expectedSources.size > 0) {
    throw new StoreRecoveryRequiredError("sealed projections contain sources absent from SQLite");
  }
  return Object.freeze(packDetails);
}

/**
 * Journal convergence writes the active manifest and removes journal files, so
 * it must never run concurrently with a live writer. The common no-journal
 * cold-open path stays lock-free; only a pending recovery briefly takes the
 * mutation lock.
 */
async function convergePendingJournals(rootPath: string): Promise<boolean> {
  if ((await listOperationJournals(rootPath)).length === 0) return false;
  const lock = await acquireMutationLock(rootPath);
  let database: Awaited<ReturnType<typeof openStoreDatabase>> | undefined;
  try {
    database = await openStoreForLifecycle(rootPath);
    await runStoreRecovery(rootPath, database);
    return true;
  } catch (error) {
    return translateStoreErrors(error);
  } finally {
    database?.close();
    await lock.release();
  }
}

async function verifyColdOpenSnapshot(rootPath: string): Promise<ColdOpenResult> {
  const database = await openStoreForLifecycle(rootPath);
  try {
    for (let attempt = 0; attempt < MAX_OPEN_RETRIES; attempt++) {
      const manifestA = await tryReadManifest(rootPath);
      const snapshot = readLocalStoreSnapshot(database);

      if (manifestA === undefined && snapshot === undefined) {
        const manifestB = await tryReadManifest(rootPath);
        if (manifestB === undefined) {
          return {
            manifest: createEmptyManifest(),
            packDetails: Object.freeze([]),
            effectivePractices: Object.freeze([]),
          };
        }
        continue;
      }

      if (
        manifestA !== undefined &&
        snapshot === undefined &&
        manifestA.generation === 0 &&
        manifestA.effectiveRevision === 0 &&
        manifestA.packs.length === 0
      ) {
        const manifestB = await tryReadManifest(rootPath);
        if (manifestsEqual(manifestA, manifestB)) {
          return {
            manifest: manifestA,
            packDetails: Object.freeze([]),
            effectivePractices: Object.freeze([]),
          };
        }
        continue;
      }

      if (manifestA === undefined || snapshot === undefined) {
        const manifestB = await tryReadManifest(rootPath);
        if (!manifestsEqual(manifestA, manifestB)) continue;
        throw new StoreRecoveryRequiredError("manifest and SQLite initialization states differ");
      }

      const tupleMatches =
        snapshot.metadata.generation === manifestA.generation &&
        snapshot.metadata.effectiveRevision === manifestA.effectiveRevision;
      if (!tupleMatches || !installedPackEntriesEqual(snapshot.activePacks, manifestA.packs)) {
        const manifestB = await tryReadManifest(rootPath);
        if (!manifestsEqual(manifestA, manifestB)) continue;
        throw new StoreRecoveryRequiredError(
          tupleMatches
            ? "SQLite Active Pack rows differ from the active manifest"
            : "manifest and SQLite tuples disagree",
        );
      }

      let packDetails: readonly PackSnapshot[];
      try {
        packDetails = await verifyArtifactsAndSources(
          rootPath,
          manifestA,
          snapshot.effectivePractices,
        );
      } catch (error) {
        const manifestB = await tryReadManifest(rootPath);
        if (!manifestsEqual(manifestA, manifestB)) continue;
        throw error;
      }

      const manifestB = await tryReadManifest(rootPath);
      if (!manifestsEqual(manifestA, manifestB)) continue;
      return {
        manifest: manifestA,
        packDetails,
        effectivePractices: snapshot.effectivePractices,
      };
    }
    throw new StoreBusyError("LocalStore changed repeatedly during cold open");
  } catch (error) {
    return translateStoreErrors(error);
  } finally {
    database.close();
  }
}

/**
 * Cold open (ADR 0007 §8): run schema migration, parse the active manifest,
 * check SQLite readability/integrity, check each active artifact exists with a
 * matching digest, read the digest-protected projection, and reconcile
 * SQLite's Active Pack / Practice source / Effective Practice against it.
 * Cold open does not scan all packs, re-parse Practice files, or regenerate
 * embeddings. Any inconsistency → `StoreRecoveryRequiredError`. A stale
 * mutation lock is reclaimed only after the recovery check passed (ADR 0007
 * §12).
 */
export async function openLocalStore(rootPath: string): Promise<ColdOpenResult> {
  return readWithJournalRecovery(rootPath, () => verifyColdOpenSnapshot(rootPath));
}

/** Only recovery-capable reads use this wrapper; the lock-free public full read does not. */
async function readWithJournalRecovery<T>(rootPath: string, read: () => Promise<T>): Promise<T> {
  for (let recoveryAttempt = 0; recoveryAttempt < 2; recoveryAttempt++) {
    await convergePendingJournals(rootPath);
    try {
      const result = await read();
      await reclaimStaleMutationLock(rootPath);
      return result;
    } catch (error) {
      if (
        error instanceof StoreRecoveryRequiredError &&
        recoveryAttempt === 0 &&
        (await listOperationJournals(rootPath)).length > 0
      ) {
        continue;
      }
      if (error instanceof StoreRecoveryRequiredError && (await isMutationLockHeld(rootPath))) {
        throw new StoreBusyError("LocalStore mutation is still in progress");
      }
      throw error;
    }
  }
  throw new StoreRecoveryRequiredError("LocalStore recovery did not converge");
}

/**
 * Lock-free read consistency protocol (ADR 0007 §8): read + validate manifest
 * A, materialize SQLite in one transaction, validate the metadata tuple
 * against A, then read + validate manifest B. Return only when A and B have
 * identical canonical manifest bytes and the SQLite tuple equals their
 * `(generation, effectiveRevision)`; otherwise retry a bounded number of times
 * and then return `StoreBusyError`. A mismatch that is stable after retries is
 * `StoreRecoveryRequiredError`.
 */
export async function readEffectivePractices(
  rootPath: string,
): Promise<readonly EffectivePractice[]> {
  const snapshot = await readConsistentSnapshotWithActivePacks(
    rootPath,
    (database, metadata) => materializeEffectivePractices(database, metadata),
    Object.freeze([]),
  );
  return snapshot.value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function snapshotIdentity(
  rootBinding: string,
  manifest: InstalledPacksManifest,
  metadata: StoreMetadataSnapshot | undefined,
): StoreSnapshotIdentity {
  return Object.freeze({
    rootBinding,
    generation: metadata?.generation ?? manifest.generation,
    effectiveRevision: metadata?.effectiveRevision ?? manifest.effectiveRevision,
    manifestDigest: digest(serializeManifest(manifest)),
  });
}

function identitiesEqual(left: StoreSnapshotIdentity, right: StoreSnapshotIdentity): boolean {
  return (
    left.rootBinding === right.rootBinding &&
    left.generation === right.generation &&
    left.effectiveRevision === right.effectiveRevision &&
    left.manifestDigest === right.manifestDigest
  );
}

async function resolvedRootBinding(rootPath: string): Promise<string> {
  return digest(await realpath(rootPath));
}

/** Read only the committed Store identity and active-pack rows. */
export async function readSnapshotIdentity(rootPath: string): Promise<StoreSnapshotIdentity> {
  const snapshot = await readConsistentSnapshotWithActivePacks(
    rootPath,
    () => undefined,
    undefined,
  );
  return snapshotIdentity(
    await resolvedRootBinding(rootPath),
    snapshot.manifest,
    snapshot.metadata,
  );
}

/**
 * Hold the Store mutation lock only while publishing already-prepared derived
 * state. The callback runs once after recovery and identity verification; it
 * must not start another Store mutation or perform long-running work.
 */
export async function withSnapshotFence<T>(
  rootPath: string,
  expected: StoreSnapshotIdentity,
  publish: () => Promise<T>,
): Promise<T> {
  return withStoreMutation(rootPath, async ({ recovery }) => {
    const current = snapshotIdentity(
      await resolvedRootBinding(rootPath),
      recovery.manifest,
      recovery.metadata,
    );
    if (!identitiesEqual(current, expected)) throw new StoreSnapshotChangedError();
    return publish();
  });
}

/** Read one full effective corpus and the identity that produced it. */
export async function readEffectivePracticeSnapshot(
  rootPath: string,
): Promise<EffectivePracticeSnapshot> {
  const snapshot = await readConsistentSnapshotWithActivePacks(
    rootPath,
    (database, metadata) => materializeEffectivePractices(database, metadata),
    Object.freeze([]),
  );
  return Object.freeze({
    identity: snapshotIdentity(
      await resolvedRootBinding(rootPath),
      snapshot.manifest,
      snapshot.metadata,
    ),
    practices: snapshot.value,
  });
}

/**
 * Read a contiguous revision range and the final canonical rows it affects.
 * Undefined means a caller must rebuild rather than guess missing history.
 */
export async function readEffectivePracticeChanges(
  rootPath: string,
  afterEffectiveRevision: number,
): Promise<EffectivePracticeChangeSnapshot | undefined> {
  if (!Number.isSafeInteger(afterEffectiveRevision) || afterEffectiveRevision < 0) {
    throw new StoreSnapshotChangedError();
  }
  const snapshot = await readConsistentSnapshotWithActivePacks(
    rootPath,
    (database, metadata) => {
      if (afterEffectiveRevision > metadata.effectiveRevision) return undefined;
      let entries: readonly EffectivePracticeChange[];
      try {
        entries = readEffectiveRevisionLog(database, afterEffectiveRevision).map((entry) =>
          Object.freeze({ revision: entry.revision, delta: entry.delta }),
        );
      } catch (error) {
        if (error instanceof SqliteStateError) return undefined;
        throw error;
      }
      let expected = afterEffectiveRevision + 1;
      for (const entry of entries) {
        if (entry.revision !== expected) return undefined;
        expected += 1;
      }
      if (expected !== metadata.effectiveRevision + 1) return undefined;
      return Object.freeze({
        deltas: Object.freeze(entries),
        currentPractices: materializeEffectivePracticesByIds(
          database,
          metadata,
          revisionDeltaPracticeIds(entries.map((entry) => entry.delta)),
        ),
      });
    },
    Object.freeze({ deltas: Object.freeze([]), currentPractices: Object.freeze([]) }),
  );
  if (snapshot.value === undefined) return undefined;
  return Object.freeze({
    identity: snapshotIdentity(
      await resolvedRootBinding(rootPath),
      snapshot.manifest,
      snapshot.metadata,
    ),
    deltas: snapshot.value.deltas,
    currentPractices: snapshot.value.currentPractices,
  });
}

/** Materialize selected current rows only when the expected Store identity remains current. */
export async function readEffectivePracticesAtSnapshot(
  rootPath: string,
  expected: StoreSnapshotIdentity,
  ids: readonly string[],
): Promise<readonly EffectivePractice[]> {
  const snapshot = await readConsistentSnapshotWithActivePacks(
    rootPath,
    (database, metadata) => materializeEffectivePracticesByIds(database, metadata, ids),
    Object.freeze([]),
  );
  const actual = snapshotIdentity(
    await resolvedRootBinding(rootPath),
    snapshot.manifest,
    snapshot.metadata,
  );
  if (!identitiesEqual(actual, expected)) throw new StoreSnapshotChangedError();
  return snapshot.value;
}

/** Callbacks are synchronous, read-only, and may be retried. Connections stay private. */
async function readConsistentSnapshot<T>(
  rootPath: string,
  read: (database: Database, metadata: StoreMetadataSnapshot) => T,
  empty: T,
): Promise<ConsistentSnapshot<T>> {
  const MAX_READ_RETRIES = 3;
  const database = await openStoreForLifecycle(rootPath);
  try {
    for (let attempt = 0; attempt < MAX_READ_RETRIES; attempt++) {
      // eslint-disable-next-line no-await-in-loop -- bounded retry is inherently sequential
      const manifestA = await tryReadManifest(rootPath);
      let snapshot: { metadata: StoreMetadataSnapshot; value: T } | undefined;
      try {
        snapshot = database.transaction(() => {
          const metadata = readStoreMetadata(database);
          if (metadata === undefined) return undefined;
          return { metadata, value: read(database, metadata) };
        })();
      } catch (error) {
        if (error instanceof SqliteStateError) throw error;
        throw new SqliteStateError("cannot read LocalStore snapshot", error);
      }
      // eslint-disable-next-line no-await-in-loop -- manifest B must follow the SQLite snapshot
      const manifestB = await tryReadManifest(rootPath);
      if (manifestA === undefined && snapshot === undefined && manifestB === undefined) {
        return Object.freeze({
          manifest: createEmptyManifest(),
          metadata: undefined,
          value: empty,
        });
      }
      // A persisted empty manifest is also a valid never-written Store.
      if (
        snapshot === undefined &&
        manifestA?.generation === 0 &&
        manifestA.effectiveRevision === 0 &&
        manifestA.packs.length === 0 &&
        manifestsEqual(manifestA, manifestB)
      ) {
        return Object.freeze({ manifest: manifestA, metadata: undefined, value: empty });
      }
      if (manifestA === undefined || snapshot === undefined || manifestB === undefined) continue;
      const tupleMatches =
        snapshot.metadata.generation === manifestA.generation &&
        snapshot.metadata.effectiveRevision === manifestA.effectiveRevision;
      if (
        tupleMatches &&
        manifestB !== undefined &&
        serializeManifest(manifestA) === serializeManifest(manifestB)
      ) {
        return Object.freeze({
          manifest: manifestA,
          metadata: snapshot.metadata,
          value: snapshot.value,
        });
      }
    }
    // Retries exhausted. Distinguish a stable mismatch (recovery required)
    // from transient concurrent writes (busy) by comparing two more reads.
    const manifestA = await tryReadManifest(rootPath);
    const manifestB = await tryReadManifest(rootPath);
    if (
      manifestA === undefined ||
      manifestB === undefined ||
      serializeManifest(manifestA) === serializeManifest(manifestB)
    ) {
      if (await isMutationLockHeld(rootPath)) {
        throw new StoreBusyError("LocalStore mutation is still in progress");
      }
      throw new StoreRecoveryRequiredError(
        "manifest and SQLite tuples disagree after repeated reads",
      );
    }
    throw new StoreBusyError("LocalStore manifest kept changing during reads");
  } catch (error) {
    translateStoreErrors(error);
  } finally {
    database.close();
  }
}

function readConsistentSnapshotWithActivePacks<T>(
  rootPath: string,
  read: (database: Database, metadata: StoreMetadataSnapshot) => T,
  empty: T,
): Promise<ConsistentSnapshot<T>> {
  return readConsistentSnapshot(
    rootPath,
    (database, metadata) => {
      readActivePackEntries(database);
      return read(database, metadata);
    },
    empty,
  );
}

/** Point reads retain cold-open journal convergence without its whole-store artifact audit. */
export async function getEffectivePractice(
  rootPath: string,
  practiceId: string,
): Promise<EffectivePractice | undefined> {
  if (!ID_REGEX.test(practiceId)) throw new InvalidPracticeIdError();
  return readWithJournalRecovery(rootPath, () =>
    readConsistentSnapshot(
      rootPath,
      (database, metadata) => readPractice(database, metadata, practiceId),
      undefined,
    ).then((snapshot) => snapshot.value),
  );
}
