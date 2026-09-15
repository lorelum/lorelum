import {
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../local-store";
import {
  createSemanticIndexService,
  createSemanticQueryService,
  type EmbeddingPort,
  type EmbeddingProfile,
  type SemanticIndexService,
  type SemanticQueryService,
} from "../query/semantic";
import { projectSemanticIndexDatabaseDefinition } from "../persistence/definitions";
import { projectSemanticIndexPaths } from "./cache";
import type { ContentAddressedCorpus } from "./cache";

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

/**
 * Bind the shared semantic SQLite implementation to one immutable, content-addressed
 * ProjectContext snapshot. The target has no mutable Store revision: a source edit
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
    projectSemanticIndexPaths(cacheRoot, snapshot, profileId);
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
  const query = createSemanticQueryService({
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
  });
  return Object.freeze({ root, index, query });
}

/** @deprecated Use createContentAddressedSemanticServices for non-project corpora too. */
export const createProjectSemanticServices = createContentAddressedSemanticServices;
/** @deprecated Use ContentAddressedSemanticServices for non-project corpora too. */
export type ProjectSemanticServices = ContentAddressedSemanticServices;
