import {
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../../local-store";
import {
  createSemanticIndexService,
  createSemanticQueryService,
  type EmbeddingPort,
  type EmbeddingProfile,
  type SemanticIndexService,
  type SemanticQueryService,
} from "../semantic";
import { projectSemanticIndexDatabaseDefinition } from "../../persistence/definitions";
import { contentSemanticIndexPaths } from "./cache";
import type { ContentAddressedCorpus } from "./cache";
import {
  createSemanticCandidateTraceService,
  type SemanticQueryDependencies,
} from "../semantic/query-service";

function identityFor(snapshot: ContentAddressedCorpus): StoreSnapshotIdentity {
  return Object.freeze({
    rootBinding: `content-addressed:${snapshot.indexCorpusDigest}`,
    generation: 0,
    effectiveRevision: 0,
    manifestDigest: snapshot.indexCorpusDigest,
  });
}

function sameIdentity(left: StoreSnapshotIdentity, right: StoreSnapshotIdentity): boolean {
  return (
    left.rootBinding === right.rootBinding &&
    left.generation === right.generation &&
    left.effectiveRevision === right.effectiveRevision &&
    left.manifestDigest === right.manifestDigest
  );
}

function practicesAtSnapshot(
  snapshot: ContentAddressedCorpus,
  expected: StoreSnapshotIdentity,
  ids: readonly string[],
): readonly EffectivePractice[] {
  if (!sameIdentity(identityFor(snapshot), expected)) throw new StoreSnapshotChangedError();
  const requested = new Set(ids);
  return Object.freeze(snapshot.practices.filter((practice) => requested.has(practice.practiceId)));
}

export interface ContentAddressedSemanticServices {
  /** Opaque virtual root. Its path is never used for cache location or source discovery. */
  readonly root: StorageRoot;
  readonly index: SemanticIndexService;
  readonly query: SemanticQueryService;
}

/** Build query dependencies against one immutable ProjectContext snapshot. */
function queryDependencies(
  snapshot: ContentAddressedCorpus,
  identity: StoreSnapshotIdentity,
  paths: (root: StorageRoot, profileId: string) => ReturnType<typeof contentSemanticIndexPaths>,
  profile: EmbeddingProfile,
  embedding: EmbeddingPort,
): SemanticQueryDependencies {
  return {
    profile,
    embedding,
    paths,
    definition: projectSemanticIndexDatabaseDefinition,
    store: {
      async readSnapshotIdentity() {
        return identity;
      },
      async readEffectivePracticeChanges() {
        return undefined;
      },
      async readEffectivePracticesAtSnapshot(_root, expected, ids) {
        return practicesAtSnapshot(snapshot, expected, ids);
      },
    },
  };
}

/**
 * Bind the shared semantic SQLite implementation to one immutable, content-addressed
 * source snapshot. The target has no mutable Store revision: a source edit
 * produces a different artifact identity, while the old artifact remains reusable.
 */
export function createContentAddressedSemanticServices(
  snapshot: ContentAddressedCorpus,
  cacheRoot: string,
  profile: EmbeddingProfile,
  embedding: EmbeddingPort,
): ContentAddressedSemanticServices {
  const identity = identityFor(snapshot);
  const root = Object.freeze({ rootPath: "content-addressed-artifact" });
  const paths = (_root: StorageRoot, profileId: string) =>
    contentSemanticIndexPaths(cacheRoot, snapshot, profileId);
  const index = createSemanticIndexService({
    profile,
    embedding,
    paths,
    definition: projectSemanticIndexDatabaseDefinition,
    store: {
      async readSnapshotIdentity() {
        return identity;
      },
      async readEffectivePracticeSnapshot() {
        return Object.freeze({ identity, practices: snapshot.practices });
      },
      async readEffectivePracticeChanges() {
        return undefined;
      },
      async withSnapshotFence(_root, expected, publish) {
        if (!sameIdentity(identity, expected)) throw new StoreSnapshotChangedError();
        return publish();
      },
    },
  });
  const query = createSemanticQueryService(
    queryDependencies(snapshot, identity, paths, profile, embedding),
  );
  return Object.freeze({ root, index, query });
}

/** Internal ProjectContext counterpart used to verify the shared N/K boundary. */
export function createContentAddressedSemanticCandidateTraceService(
  snapshot: ContentAddressedCorpus,
  cacheRoot: string,
  profile: EmbeddingProfile,
  embedding: EmbeddingPort,
) {
  const identity = identityFor(snapshot);
  const paths = (_root: StorageRoot, profileId: string) =>
    contentSemanticIndexPaths(cacheRoot, snapshot, profileId);
  return createSemanticCandidateTraceService(
    queryDependencies(snapshot, identity, paths, profile, embedding),
  );
}
