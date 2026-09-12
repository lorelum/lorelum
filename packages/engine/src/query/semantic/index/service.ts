import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  StoreSnapshotChangedError,
  type LocalStore,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../../../local-store";
import { acquireMutationLock } from "../../../local-store/storage/mutation-lock";
import type { EmbeddingPort } from "../encoding";
import { validateEmbeddingBatch } from "../encoding";
import {
  SemanticEmbeddingError,
  SemanticIndexError,
  SemanticIndexSnapshotChangedError,
} from "../errors";
import type { EmbeddingProfile } from "../profile";
import { projectSemanticPractice, type SemanticDocument } from "../projection";
import {
  metadataFor,
  isCompatibleMetadata,
  stateForMetadata,
  statusFor,
  type SemanticIndexMetadata,
  type SemanticIndexStatus,
} from "./metadata";
import {
  applySemanticIndexChanges,
  initializeSemanticIndex,
  readSemanticIndexMetadata,
  readSemanticIndexVector,
  verifySemanticIndexIntegrity,
} from "./database";
import { planIncrementalSemanticIndex } from "./incremental";

const INDEX_FILE_NAME = "active.sqlite";
const WRITER_DIRECTORY = "writer";

export interface SemanticIndexBuildResult {
  readonly status: SemanticIndexStatus;
  readonly built: boolean;
}

export interface SemanticIndexService {
  status(root: StorageRoot): Promise<SemanticIndexStatus>;
  build(root: StorageRoot): Promise<SemanticIndexBuildResult>;
  rebuild(root: StorageRoot): Promise<SemanticIndexBuildResult>;
}

export interface SemanticIndexDependencies {
  readonly store: Pick<
    LocalStore,
    | "readSnapshotIdentity"
    | "readEffectivePracticeSnapshot"
    | "readEffectivePracticeChanges"
    | "withSnapshotFence"
  >;
  readonly profile: EmbeddingProfile;
  readonly embedding: EmbeddingPort;
}

interface IndexPaths {
  readonly directory: string;
  readonly active: string;
  readonly writer: string;
}

function paths(rootPath: string, profileId: string): IndexPaths {
  const directory = join(rootPath, "indexes", "semantic", "v1", profileId);
  return Object.freeze({
    directory,
    active: join(directory, INDEX_FILE_NAME),
    writer: join(directory, WRITER_DIRECTORY),
  });
}

async function activeMetadata(path: string): Promise<SemanticIndexMetadata | undefined> {
  try {
    await access(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new SemanticIndexError("Cannot access semantic SQLite index", { cause: error });
  }
  let database: Database | undefined;
  try {
    database = new Database(path, { readonly: true });
    verifySemanticIndexIntegrity(database);
    return readSemanticIndexMetadata(database);
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot open semantic SQLite index", { cause: error });
  } finally {
    try {
      database?.close();
    } catch {
      // The metadata/open error is more useful than cleanup failure.
    }
  }
}

async function embedDocuments(
  port: EmbeddingPort,
  profile: EmbeddingProfile,
  documents: readonly SemanticDocument[],
): Promise<readonly Float32Array[]> {
  if (!Number.isSafeInteger(port.maxBatchSize) || port.maxBatchSize < 1) {
    throw new SemanticEmbeddingError("Embedding batch limit is invalid");
  }
  const vectors: Float32Array[] = [];
  for (let start = 0; start < documents.length; start += port.maxBatchSize) {
    const batch = documents.slice(start, start + port.maxBatchSize);
    const inputs = batch.map((document) => document.text);
    // eslint-disable-next-line no-await-in-loop -- the Backend runtime admits one batch at a time.
    const result = await port.embed(inputs);
    vectors.push(...validateEmbeddingBatch(profile, inputs, result));
  }
  return Object.freeze(vectors);
}

export function createSemanticIndexService(
  dependencies: SemanticIndexDependencies,
): SemanticIndexService {
  const { store, profile, embedding } = dependencies;

  const status = async (root: StorageRoot): Promise<SemanticIndexStatus> => {
    const identity = await store.readSnapshotIdentity(root);
    try {
      const metadata = await activeMetadata(paths(root.rootPath, profile.profileId).active);
      if (metadata === undefined) return statusFor("missing", profile);
      return statusFor(stateForMetadata(metadata, identity, profile), profile, metadata);
    } catch (error) {
      if (error instanceof SemanticIndexError) return statusFor("incompatible", profile);
      throw error;
    }
  };

  const publish = async (
    root: StorageRoot,
    indexPaths: IndexPaths,
    staging: string,
    identity: StoreSnapshotIdentity,
    metadata: SemanticIndexMetadata,
  ): Promise<SemanticIndexBuildResult> => {
    await store.withSnapshotFence(root, identity, async () => {
      await rename(staging, indexPaths.active);
    });
    return Object.freeze({ status: statusFor("ready", profile, metadata), built: true });
  };

  const fullBuild = async (
    root: StorageRoot,
    indexPaths: IndexPaths,
  ): Promise<SemanticIndexBuildResult> => {
    const snapshot = await store.readEffectivePracticeSnapshot(root);
    const documents = Object.freeze(snapshot.practices.map(projectSemanticPractice));
    const vectors =
      documents.length === 0
        ? Object.freeze([])
        : await embedDocuments(embedding, profile, documents);
    const metadata = metadataFor(snapshot.identity, profile, vectors.length);
    await mkdir(indexPaths.directory, { recursive: true });
    const staging = join(indexPaths.directory, `build-${randomUUID()}.sqlite`);
    let database: Database | undefined;
    let published = false;
    try {
      database = new Database(staging);
      initializeSemanticIndex(database, metadata, documents, vectors);
      verifySemanticIndexIntegrity(database);
      const written = readSemanticIndexMetadata(database);
      if (
        written.profileId !== metadata.profileId ||
        written.vectorCount !== metadata.vectorCount
      ) {
        throw new SemanticIndexError("Staged semantic index metadata differs from build metadata");
      }
      database.close();
      database = undefined;
      const result = await publish(root, indexPaths, staging, snapshot.identity, written);
      published = true;
      return result;
    } finally {
      try {
        database?.close();
      } catch {
        // Preserve the primary build or publication failure.
      }
      if (!published) await rm(staging, { force: true }).catch(() => undefined);
    }
  };

  const incrementalBuild = async (
    root: StorageRoot,
    indexPaths: IndexPaths,
    existing: SemanticIndexMetadata,
  ): Promise<SemanticIndexBuildResult | undefined> => {
    const changes = await store.readEffectivePracticeChanges(root, existing.effectiveRevision);
    if (
      changes === undefined ||
      !isCompatibleMetadata(existing, profile, changes.identity.rootBinding) ||
      changes.identity.effectiveRevision < existing.effectiveRevision
    ) {
      return undefined;
    }
    await mkdir(indexPaths.directory, { recursive: true });
    const staging = join(indexPaths.directory, `build-${randomUUID()}.sqlite`);
    let database: Database | undefined;
    let published = false;
    try {
      await copyFile(indexPaths.active, staging);
      database = new Database(staging);
      verifySemanticIndexIntegrity(database);
      const stagedMetadata = readSemanticIndexMetadata(database);
      if (
        stagedMetadata.effectiveRevision !== existing.effectiveRevision ||
        !isCompatibleMetadata(stagedMetadata, profile, changes.identity.rootBinding)
      ) {
        throw new SemanticIndexError(
          "Active semantic index changed while staging an incremental build",
        );
      }
      const plan = planIncrementalSemanticIndex(
        changes.deltas.map((change) => change.delta),
        changes.currentPractices,
        (practiceId) => readSemanticIndexVector(database!, practiceId, profile.dimensions),
      );
      const embedded = await embedDocuments(embedding, profile, plan.documentsToEmbed);
      const embeddedByPracticeId = new Map(
        plan.documentsToEmbed.map(
          (document, index) => [document.practiceId, embedded[index]!] as const,
        ),
      );
      const vectors = plan.documents.map((document) => {
        const reused = plan.reusableVectors.get(document.practiceId);
        const embeddedVector = embeddedByPracticeId.get(document.practiceId);
        if (reused !== undefined) return reused;
        if (embeddedVector !== undefined) return embeddedVector;
        throw new SemanticIndexError("Incremental semantic index vector is missing");
      });
      const written = applySemanticIndexChanges(
        database,
        metadataFor(changes.identity, profile, 0),
        plan.removedPracticeIds,
        plan.documents,
        vectors,
      );
      verifySemanticIndexIntegrity(database);
      const verified = readSemanticIndexMetadata(database);
      if (
        verified.effectiveRevision !== written.effectiveRevision ||
        verified.vectorCount !== written.vectorCount
      ) {
        throw new SemanticIndexError(
          "Staged semantic index metadata differs from incremental target",
        );
      }
      database.close();
      database = undefined;
      const result = await publish(root, indexPaths, staging, changes.identity, verified);
      published = true;
      return result;
    } finally {
      try {
        database?.close();
      } catch {
        // Preserve the primary build or publication failure.
      }
      if (!published) await rm(staging, { force: true }).catch(() => undefined);
    }
  };

  const build = async (root: StorageRoot, force: boolean): Promise<SemanticIndexBuildResult> => {
    const indexPaths = paths(root.rootPath, profile.profileId);
    await mkdir(indexPaths.writer, { recursive: true });
    const lock = await acquireMutationLock(indexPaths.writer);
    try {
      const current = await store.readSnapshotIdentity(root);
      let existing: SemanticIndexMetadata | undefined;
      try {
        existing = await activeMetadata(indexPaths.active);
      } catch (error) {
        if (!(error instanceof SemanticIndexError)) throw error;
      }
      if (!force && existing !== undefined) {
        const state = stateForMetadata(existing, current, profile);
        if (state === "ready")
          return Object.freeze({ status: statusFor(state, profile, existing), built: false });
        if (state === "stale" && existing.effectiveRevision <= current.effectiveRevision) {
          const incremental = await incrementalBuild(root, indexPaths, existing);
          if (incremental !== undefined) return incremental;
        }
      }
      return await fullBuild(root, indexPaths);
    } catch (error) {
      if (error instanceof StoreSnapshotChangedError)
        throw new SemanticIndexSnapshotChangedError({ cause: error });
      if (
        error instanceof SemanticIndexError ||
        error instanceof StoreBusyError ||
        error instanceof StoreRecoveryRequiredError
      )
        throw error;
      throw new SemanticIndexError("Cannot build semantic index", { cause: error });
    } finally {
      await lock.release();
    }
  };

  return Object.freeze({
    status,
    build: (root: StorageRoot) => build(root, false),
    rebuild: (root: StorageRoot) => build(root, true),
  });
}
