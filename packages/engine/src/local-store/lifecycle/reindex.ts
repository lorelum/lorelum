import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  diffEffectivePractices,
  reconcileEffectivePractices,
  type EffectivePractice,
  type PracticeSource,
} from "../model";
import { artifactPath, calculateArtifactDigest } from "../storage/artifacts/artifact-store";
import { decodeSnapshot } from "../storage/artifacts/snapshot-codec";
import {
  parseProjection,
  PROJECTION_RELATIVE_PATH,
  type SnapshotProjection,
} from "../storage/artifacts/projection";
import {
  ArtifactIntegrityError,
  ManifestError,
  SqliteStateError,
  StoreRecoveryRequiredError,
} from "../storage/errors";
import {
  clearOperationJournal,
  createOperationJournalRecord,
  listOperationJournals,
  writeOperationJournal,
} from "../storage/journal/operation-journal";
import {
  readManifest,
  writeManifest,
  type InstalledPackManifestEntry,
  type InstalledPacksManifest,
} from "../storage/manifest/manifest-store";
import { acquireMutationLock } from "../storage/mutation-lock";
import { openStoreDatabase, sqlitePath } from "../storage/sqlite/database";
import { readPendingRevisionNotifications } from "../storage/sqlite/revision-outbox";
import { readLocalStoreSnapshot } from "../storage/sqlite/snapshot-reader";
import { writeDerivedState } from "../storage/sqlite/state-writer";

import { deliverRevisionNotifications } from "./mutation";
import { nextStoreCounter } from "./counters";
import { runStoreRecovery } from "./recovery";
import type { EffectiveRevisionHook, ReindexResult } from "./types";

function entryPath(rootPath: string, entry: InstalledPackManifestEntry): string {
  return artifactPath(rootPath, entry.storageKey, entry.artifactDigest);
}

async function readSealedProjection(artifactDir: string): Promise<SnapshotProjection> {
  let text: string;
  try {
    text = await readFile(join(artifactDir, PROJECTION_RELATIVE_PATH), "utf8");
  } catch (error) {
    throw new ArtifactIntegrityError(
      artifactDir,
      "sealed projection cannot be read: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  return parseProjection(text, artifactDir);
}

/**
 * The sealed projection and the re-decoded candidate must describe the same
 * Pack — otherwise the snapshot was tampered or the codec drifted, and
 * reindex must not overwrite derived state with it.
 */
function verifyProjectionMatches(
  entry: InstalledPackManifestEntry,
  sources: readonly PracticeSource[],
  decisions: readonly import("@lorelum/format").DecisionNode[],
  projection: SnapshotProjection,
): void {
  if (projection.pack.name !== entry.packName || projection.pack.version !== entry.packVersion) {
    throw new ManifestError(entry.storageKey, "projection pack metadata differs from the manifest");
  }
  const bySourcePath = new Map(sources.map((source) => [source.sourcePath, source] as const));
  if (projection.practices.length !== sources.length) {
    throw new ManifestError(
      entry.storageKey,
      "projection practice count differs from re-parsed snapshot",
    );
  }
  for (const expected of projection.practices) {
    const source = bySourcePath.get(expected.sourcePath);
    if (
      source === undefined ||
      source.practiceId !== expected.id ||
      source.contentDigest !== expected.contentDigest ||
      source.canonicalPractice.canonicalContent !== expected.canonicalContent
    ) {
      throw new ManifestError(
        entry.storageKey,
        `projection practice ${expected.id} differs from re-parsed snapshot`,
      );
    }
  }
  if (JSON.stringify(projection.decisions) !== JSON.stringify(decisions)) {
    throw new ManifestError(
      entry.storageKey,
      "projection decisions differ from re-parsed snapshot",
    );
  }
}

/**
 * Merge every pack's sources from scratch. Packs are grouped by name and
 * reconciled one candidate at a time (candidate.pack.name must equal each
 * source's packName, which the merge rules assert); a cross-pack conflict
 * surfaces as `PracticeConflictError` and aborts the reindex. Decisions are
 * not part of the merge (they are per-pack, sealed in the projection).
 */
function mergeSources(sources: readonly PracticeSource[]): readonly EffectivePractice[] {
  const byPack = new Map<string, PracticeSource[]>();
  for (const source of sources) {
    const group = byPack.get(source.packName);
    if (group === undefined) byPack.set(source.packName, [source]);
    else group.push(source);
  }
  let reconciled = {
    sources: Object.freeze([] as readonly PracticeSource[]),
    effectivePractices: Object.freeze([] as readonly EffectivePractice[]),
  };
  for (const [packName, packSources] of byPack) {
    const candidate = {
      pack: Object.freeze({ name: packName, version: "0.0.0" }),
      sources: Object.freeze(packSources),
      decisions: Object.freeze([]),
    };
    reconciled = reconcileEffectivePractices(reconciled.sources, candidate);
  }
  return reconciled.effectivePractices;
}

function withFreshRevision(manifest: InstalledPacksManifest): InstalledPacksManifest {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    generation: nextStoreCounter(manifest.generation, "generation"),
    effectiveRevision: nextStoreCounter(manifest.effectiveRevision, "effectiveRevision"),
    packs: manifest.packs,
  });
}

function sqliteErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "rootCause" in current ? current.rootCause : undefined;
  }
  return undefined;
}

function sqliteErrorMessage(error: unknown): string {
  let current: unknown = error;
  const messages: string[] = [];
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) break;
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "rootCause" in current ? current.rootCause : undefined;
  }
  return messages.join(": ");
}

function isRebuildableStructuralError(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") return true;
  return /no such (?:table|column)|malformed database schema/i.test(sqliteErrorMessage(error));
}

async function recreateDatabase(rootPath: string) {
  await Promise.all(
    ["", "-wal", "-shm"].map((suffix) => rm(sqlitePath(rootPath) + suffix, { force: true })),
  );
  return openStoreDatabase(rootPath);
}

async function openDatabaseForReindex(rootPath: string) {
  try {
    return await openStoreDatabase(rootPath);
  } catch (error) {
    if (!isRebuildableStructuralError(error)) throw error;
    // Only positively identified corruption is destructive. Unsupported newer
    // schemas, permissions, locks, and generic I/O errors are preserved.
    return recreateDatabase(rootPath);
  }
}

/**
 * Re-derive the whole store from the active manifest's snapshots (ADR 0007
 * §8). `reindex` is the recovery entry point and bypasses cold open: it
 * succeeds precisely where `open()` fails. It takes the active manifest's
 * Pack snapshots as its only input, re-runs format validation and derived-data
 * construction, generates a fresh `effectiveRevision`, and never scans or
 * revives historical artifacts.
 */
export async function reindexStore(
  rootPath: string,
  hook: EffectiveRevisionHook | undefined,
): Promise<ReindexResult> {
  const committed = await (async () => {
    const lock = await acquireMutationLock(rootPath);
    let database: Awaited<ReturnType<typeof openStoreDatabase>> | undefined;
    try {
      const priorJournalIds = await listOperationJournals(rootPath);
      database = await openDatabaseForReindex(rootPath);
      try {
        readLocalStoreSnapshot(database);
      } catch (error) {
        if (isRebuildableStructuralError(error)) {
          database.close();
          database = undefined;
          database = await recreateDatabase(rootPath);
        } else if (!(error instanceof SqliteStateError)) {
          throw error;
        }
        // Non-structural derived-content errors are overwritten below.
      }

      // A readable old tuple can deterministically converge an interrupted
      // mutation before reindex selects its authoritative manifest. If SQLite is
      // missing/inconsistent, reindex intentionally falls back to the current
      // active manifest and supersedes the old journals only after the rebuild
      // commits successfully.
      let manifest: InstalledPacksManifest;
      try {
        manifest = (await runStoreRecovery(rootPath, database)).manifest;
      } catch (error) {
        if (
          !(error instanceof StoreRecoveryRequiredError) &&
          !(error instanceof SqliteStateError)
        ) {
          throw error;
        }
        manifest = await readManifest(rootPath);
      }

      // Re-decode every active snapshot and verify the re-parsed result matches
      // the sealed projection before touching any derived state. Decoding is
      // independent per pack — run it in parallel, then flatten in manifest order.
      const decodedByIndex = await Promise.all(
        manifest.packs.map(async (entry) => {
          const artifactDir = entryPath(rootPath, entry);
          if ((await calculateArtifactDigest(artifactDir)) !== entry.artifactDigest) {
            throw new ManifestError(
              artifactDir,
              "artifact digest does not match the active manifest",
            );
          }
          const decoded = await decodeSnapshot(artifactDir);
          const projection = await readSealedProjection(artifactDir);
          verifyProjectionMatches(
            entry,
            decoded.candidate.sources,
            decoded.candidate.decisions,
            projection,
          );
          return decoded.candidate.sources;
        }),
      );
      const sources: PracticeSource[] = decodedByIndex.flat();

      // Reconcile every pack together from scratch — no existing state is
      // trusted, and no uninstalled pack is revived.
      const effectivePractices = mergeSources(sources);

      // Reindex is a recovery boundary, not a normal revision delta. The
      // outbox still notifies hooks of the complete current corpus, while the
      // retained index history is deliberately cleared so every derived-index
      // checkpoint from before recovery must take its existing full path.
      const delta = diffEffectivePractices([], effectivePractices);
      const targetManifest = withFreshRevision(manifest);
      const shouldQueueNotification =
        hook !== undefined || readPendingRevisionNotifications(database).length > 0;
      const journal = createOperationJournalRecord("reindex", manifest, targetManifest);
      await writeOperationJournal(rootPath, journal);
      await writeManifest(rootPath, targetManifest);
      const derivedState = {
        generation: targetManifest.generation,
        effectiveRevision: targetManifest.effectiveRevision,
        activePacks: targetManifest.packs,
        effectivePractices,
        revisionNotification: !shouldQueueNotification
          ? undefined
          : { delta, supersedesPending: true },
        clearRevisionLog: true,
      } as const;
      try {
        writeDerivedState(database, derivedState);
      } catch (error) {
        if (!isRebuildableStructuralError(error)) throw error;
        database.close();
        database = undefined;
        database = await recreateDatabase(rootPath);
        writeDerivedState(database, derivedState);
      }
      await clearOperationJournal(rootPath, journal.operationId);
      for (const priorJournalId of priorJournalIds) {
        // eslint-disable-next-line no-await-in-loop -- cleanup follows commit order
        await clearOperationJournal(rootPath, priorJournalId);
      }
      return Object.freeze({
        generation: targetManifest.generation,
        effectiveRevision: targetManifest.effectiveRevision,
        delta,
        diagnostics: Object.freeze([]),
        cleanupPending: false,
      });
    } finally {
      database?.close();
      await lock.release();
    }
  })();
  const notificationPending = await deliverRevisionNotifications(
    rootPath,
    hook,
    committed.effectiveRevision,
  );
  return Object.freeze({ ...committed, notificationPending });
}
