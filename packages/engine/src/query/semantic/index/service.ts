import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  StoreSnapshotChangedError,
  type LocalStore,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../../../local-store";
import { acquireMutationLock } from "../../../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../../../persistence/database/connection";
import { semanticIndexDatabaseDefinition } from "../../../persistence/definitions";
import { embedInBatches, type EmbeddingPort } from "../encoding";
import { SemanticIndexError, SemanticIndexSnapshotChangedError } from "../errors";
import type { EmbeddingProfile, VectorExecution } from "../profile";
import type { PracticeVectorProjection, EmbeddingInput } from "../representation";
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
  readSemanticIndexVectors,
  type SemanticIndexConnection,
  type SemanticIndexDatabaseDefinition,
  verifySemanticIndexIntegrity,
} from "./database";
import { planIncrementalSemanticIndex } from "./incremental";
import { semanticIndexPaths, type SemanticIndexPaths } from "./paths";

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
  readonly execution: VectorExecution;
  readonly embedding: EmbeddingPort;
  /** Store-local by default; ProjectContext supplies a content-addressed artifact location. */
  readonly paths?: (root: StorageRoot, profileId: string) => SemanticIndexPaths;
  readonly definition?: SemanticIndexDatabaseDefinition;
}

async function activeMetadata(
  path: string,
  definition: SemanticIndexDatabaseDefinition,
): Promise<SemanticIndexMetadata | undefined> {
  try {
    await access(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new SemanticIndexError("Cannot access semantic SQLite index", { cause: error });
  }
  let connection: SemanticIndexConnection | undefined;
  try {
    connection = openSqliteConnection(path, definition.schema, {
      readonly: true,
    });
    return readSemanticIndexMetadata(connection);
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot open semantic SQLite index", { cause: error });
  } finally {
    try {
      connection?.close();
    } catch {
      // The metadata/open error is more useful than cleanup failure.
    }
  }
}

async function embedInputs(
  port: EmbeddingPort,
  profile: EmbeddingProfile,
  inputs: readonly EmbeddingInput[],
): Promise<readonly Float32Array[]> {
  return embedInBatches(
    profile,
    port,
    inputs.map((input) => input.text),
  );
}

function inputsForDocuments(
  documents: readonly PracticeVectorProjection[],
): readonly EmbeddingInput[] {
  return Object.freeze(documents.flatMap((document) => document.inputs));
}

export function createSemanticIndexService(
  dependencies: SemanticIndexDependencies,
): SemanticIndexService {
  const { store, execution, embedding } = dependencies;
  const { profile, method } = execution;
  const definition = dependencies.definition ?? semanticIndexDatabaseDefinition;
  const pathsFor =
    dependencies.paths ??
    ((root: StorageRoot, profileId: string) => semanticIndexPaths(root.rootPath, profileId));

  const status = async (root: StorageRoot): Promise<SemanticIndexStatus> => {
    const identity = await store.readSnapshotIdentity(root);
    try {
      const metadata = await activeMetadata(pathsFor(root, profile.profileId).active, definition);
      if (metadata === undefined) return statusFor("missing", profile);
      return statusFor(stateForMetadata(metadata, identity, profile), profile, metadata);
    } catch (error) {
      if (error instanceof SemanticIndexError) return statusFor("incompatible", profile);
      throw error;
    }
  };

  const publish = async (
    root: StorageRoot,
    indexPaths: SemanticIndexPaths,
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
    indexPaths: SemanticIndexPaths,
  ): Promise<SemanticIndexBuildResult> => {
    const snapshot = await store.readEffectivePracticeSnapshot(root);
    const documents = Object.freeze(
      snapshot.practices.map((practice) => method.projectDocument(practice)),
    );
    const inputs = inputsForDocuments(documents);
    const flatVectors =
      inputs.length === 0 ? Object.freeze([]) : await embedInputs(embedding, profile, inputs);
    let vectorIndex = 0;
    const vectors = Object.freeze(
      documents.map((document) =>
        Object.freeze(
          document.inputs.map(() => {
            const vector = flatVectors[vectorIndex];
            vectorIndex += 1;
            if (vector === undefined)
              throw new SemanticIndexError("Semantic index view vector is missing");
            return vector;
          }),
        ),
      ),
    );
    const metadata = metadataFor(snapshot.identity, profile, documents.length);
    await mkdir(indexPaths.directory, { recursive: true });
    const staging = join(indexPaths.directory, `build-${randomUUID()}.sqlite`);
    let connection: SemanticIndexConnection | undefined;
    let published = false;
    try {
      connection = openSqliteConnection(staging, definition.schema);
      initializeSemanticIndex(connection, metadata, documents, vectors, definition);
      verifySemanticIndexIntegrity(connection);
      const written = readSemanticIndexMetadata(connection);
      if (
        written.profileId !== metadata.profileId ||
        written.vectorCount !== metadata.vectorCount
      ) {
        throw new SemanticIndexError("Staged semantic index metadata differs from build metadata");
      }
      connection.close();
      connection = undefined;
      const result = await publish(root, indexPaths, staging, snapshot.identity, written);
      published = true;
      return result;
    } finally {
      try {
        connection?.close();
      } catch {
        // Preserve the primary build or publication failure.
      }
      if (!published) await rm(staging, { force: true }).catch(() => undefined);
    }
  };

  const incrementalBuild = async (
    root: StorageRoot,
    indexPaths: SemanticIndexPaths,
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
    let connection: SemanticIndexConnection | undefined;
    let published = false;
    try {
      await copyFile(indexPaths.active, staging);
      connection = openSqliteConnection(staging, definition.schema);
      verifySemanticIndexIntegrity(connection);
      const stagedMetadata = readSemanticIndexMetadata(connection);
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
        (practiceId) => readSemanticIndexVectors(connection!, practiceId, profile.dimensions),
        method,
      );
      const embedded = await embedInputs(embedding, profile, plan.inputsToEmbed);
      const embeddedByDigest = new Map(
        plan.inputsToEmbed.map((input, index) => [input.inputDigest, embedded[index]!] as const),
      );
      const vectors = plan.documents.map((document) =>
        Object.freeze(
          document.inputs.map((input) => {
            const reused = plan.reusableVectors.get(input.inputDigest);
            const embeddedVector = embeddedByDigest.get(input.inputDigest);
            if (reused !== undefined) return reused;
            if (embeddedVector !== undefined) return embeddedVector;
            throw new SemanticIndexError("Incremental semantic index input embedding is missing");
          }),
        ),
      );
      const written = applySemanticIndexChanges(
        connection,
        metadataFor(changes.identity, profile, plan.documents.length),
        plan.removedPracticeIds,
        plan.documents,
        vectors,
      );
      verifySemanticIndexIntegrity(connection);
      const verified = readSemanticIndexMetadata(connection);
      if (
        verified.effectiveRevision !== written.effectiveRevision ||
        verified.vectorCount !== written.vectorCount
      ) {
        throw new SemanticIndexError(
          "Staged semantic index metadata differs from incremental target",
        );
      }
      connection.close();
      connection = undefined;
      const result = await publish(root, indexPaths, staging, changes.identity, verified);
      published = true;
      return result;
    } finally {
      try {
        connection?.close();
      } catch {
        // Preserve the primary build or publication failure.
      }
      if (!published) await rm(staging, { force: true }).catch(() => undefined);
    }
  };

  const build = async (root: StorageRoot, force: boolean): Promise<SemanticIndexBuildResult> => {
    const indexPaths = pathsFor(root, profile.profileId);
    await mkdir(indexPaths.writer, { recursive: true });
    const lock = await acquireMutationLock(indexPaths.writer);
    try {
      const current = await store.readSnapshotIdentity(root);
      let existing: SemanticIndexMetadata | undefined;
      try {
        existing = await activeMetadata(indexPaths.active, definition);
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
