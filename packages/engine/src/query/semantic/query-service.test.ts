import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  StoreBusyError,
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../../local-store";
import { canonicalizePractice, type RevisionDelta } from "../../local-store/model";
import type { EmbeddingPort } from "./encoding";
import { SemanticIndexNotReadyError, SemanticIndexQueryError } from "./errors";
import { createSemanticIndexService } from "./index/service";
import { createEmbeddingProfile } from "./profile";
import { createSemanticQueryService } from "./query-service";

const encodingId = "a".repeat(64);

function identity(rootPath: string, revision = 1): StoreSnapshotIdentity {
  return Object.freeze({
    rootBinding: `test:${rootPath}`,
    generation: revision,
    effectiveRevision: revision,
    manifestDigest: `${revision}`.padStart(64, "0"),
  });
}

function practice(id: string, body = id): EffectivePractice {
  const canonical = canonicalizePractice({
    id,
    title: id,
    stage: "implementation",
    tech_stack: ["typescript"],
    applies_when: body,
    body,
    severity: "warn",
  });
  return { practiceId: id, ...canonical, sources: [] };
}

function vectorFor(text: string): readonly number[] {
  if (text.includes("platform.beta")) return [0, 1];
  if (text.includes("beta query")) return [0, 1];
  return [1, 0];
}

function port(): EmbeddingPort & { readonly calls: readonly string[][] } {
  const calls: string[][] = [];
  return {
    maxBatchSize: 8,
    calls,
    async embed(inputs) {
      calls.push([...inputs]);
      return { encodingId, vectors: inputs.map(vectorFor) };
    },
  };
}

async function withRoot(run: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-semantic-query-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

type FakeStore = {
  current: StoreSnapshotIdentity;
  practices: readonly EffectivePractice[];
  changes:
    | {
        readonly identity: StoreSnapshotIdentity;
        readonly deltas: readonly { readonly revision: number; readonly delta: RevisionDelta }[];
        readonly currentPractices: readonly EffectivePractice[];
      }
    | undefined;
  readSnapshotIdentity(root: StorageRoot): Promise<StoreSnapshotIdentity>;
  readEffectivePracticeChanges(
    root: StorageRoot,
    afterEffectiveRevision: number,
  ): Promise<FakeStore["changes"]>;
  readEffectivePracticesAtSnapshot(
    root: StorageRoot,
    expected: StoreSnapshotIdentity,
    ids: readonly string[],
  ): Promise<readonly EffectivePractice[]>;
};

function createStore(rootPath: string, initial: readonly EffectivePractice[]): FakeStore {
  let store: FakeStore;
  store = {
    current: identity(rootPath),
    practices: initial,
    changes: undefined,
    async readSnapshotIdentity(_root: StorageRoot): Promise<StoreSnapshotIdentity> {
      return store.current;
    },
    async readEffectivePracticeChanges(
      _root: StorageRoot,
      _afterEffectiveRevision: number,
    ): Promise<FakeStore["changes"]> {
      return store.changes;
    },
    async readEffectivePracticesAtSnapshot(
      _root: StorageRoot,
      expected: StoreSnapshotIdentity,
      ids: readonly string[],
    ): Promise<readonly EffectivePractice[]> {
      if (!sameIdentity(store.current, expected)) throw new StoreSnapshotChangedError();
      const wanted = new Set(ids);
      return store.practices.filter((item: EffectivePractice) => wanted.has(item.practiceId));
    },
  };
  return store;
}

function sameIdentity(left: StoreSnapshotIdentity, right: StoreSnapshotIdentity): boolean {
  return (
    left.rootBinding === right.rootBinding &&
    left.generation === right.generation &&
    left.effectiveRevision === right.effectiveRevision &&
    left.manifestDigest === right.manifestDigest
  );
}

async function build(
  rootPath: string,
  store: FakeStore,
  profile: ReturnType<typeof createEmbeddingProfile>,
  embedding: EmbeddingPort,
): Promise<void> {
  const index = createSemanticIndexService({
    store: {
      readSnapshotIdentity: store.readSnapshotIdentity,
      readEffectivePracticeSnapshot: async () => ({
        identity: store.current,
        practices: store.practices,
      }),
      async readEffectivePracticeChanges(root, afterEffectiveRevision) {
        const changes = await store.readEffectivePracticeChanges(root, afterEffectiveRevision);
        return changes === undefined
          ? undefined
          : { ...changes, currentPractices: store.practices };
      },
      async withSnapshotFence(_root, expected, publish) {
        if (!sameIdentity(store.current, expected)) throw new StoreSnapshotChangedError();
        return publish();
      },
    },
    profile,
    embedding,
  });
  await index.build({ rootPath });
}

function semantic(
  store: FakeStore,
  profile: ReturnType<typeof createEmbeddingProfile>,
  embedding: EmbeddingPort,
) {
  return createSemanticQueryService({ store, profile, embedding });
}

test("returns complete semantic results with deterministic score and ID ordering", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [
      practice("platform.beta"),
      practice("platform.alpha"),
      practice("platform.alpha2"),
    ]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);

    const result = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: "alpha", limit: 3 },
    );
    expect(result.mode).toBe("semantic");
    expect(result.coverage).toBe("complete");
    expect(result.results.map((hit) => hit.practiceId)).toEqual([
      "platform.alpha",
      "platform.alpha2",
      "platform.beta",
    ]);
    expect(embedding.calls).toHaveLength(2);
  });
});

test("empty index does not call the embedding port", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, []);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    const result = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: "anything" },
    );
    expect(result).toMatchObject({ mode: "semantic", coverage: "complete", results: [] });
    expect(embedding.calls).toEqual([]);
  });
});

test("partial coverage excludes all Practice IDs touched by retained deltas", async () => {
  await withRoot(async (rootPath) => {
    const original = practice("platform.original");
    const retained = practice("platform.retained");
    const store = createStore(rootPath, [original, retained]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    const next = identity(rootPath, 2);
    store.current = next;
    store.practices = [practice("platform.original", "changed"), retained];
    store.changes = {
      identity: next,
      deltas: [
        {
          revision: 2,
          delta: {
            added: ["platform.original"],
            changed: ["platform.original"],
            invalidated: ["platform.removed"],
          },
        },
      ],
      currentPractices: [practice("platform.original", "changed")],
    };

    const result = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: "beta query" },
    );
    expect(result.coverage).toBe("partial");
    expect(result.results.map((hit) => hit.practiceId)).toEqual(["platform.retained"]);
    expect(embedding.calls).toHaveLength(2);
  });
});

test("partial query with every vector excluded returns empty without embedding", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [practice("platform.only")]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    const next = identity(rootPath, 2);
    store.current = next;
    store.changes = {
      identity: next,
      deltas: [{ revision: 2, delta: { added: [], changed: ["platform.only"], invalidated: [] } }],
      currentPractices: [],
    };
    const result = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: "anything" },
    );
    expect(result).toMatchObject({ coverage: "partial", results: [] });
    expect(embedding.calls).toHaveLength(1);
  });
});

test("history gaps are explicit and never silently fall back to keyword", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [practice("platform.only")]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    store.current = identity(rootPath, 3);
    store.changes = undefined;
    await expect(
      semantic(store, profile, embedding).query({ rootPath }, { text: "anything" }),
    ).rejects.toBeInstanceOf(SemanticIndexNotReadyError);
  });
});

test("candidate digest mismatch is a typed query failure", async () => {
  await withRoot(async (rootPath) => {
    const original = practice("platform.only");
    const store = createStore(rootPath, [original]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    const invalid = { ...original, contentDigest: "f".repeat(64) };
    store.practices = [invalid];
    await expect(
      semantic(store, profile, embedding).query({ rootPath }, { text: "anything" }),
    ).rejects.toBeInstanceOf(SemanticIndexQueryError);
  });
});

test("Store changes during candidate read are retried three times", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [practice("platform.only")]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    let reads = 0;
    store.readEffectivePracticesAtSnapshot = async () => {
      reads += 1;
      throw new StoreSnapshotChangedError();
    };
    await expect(
      semantic(store, profile, embedding).query({ rootPath }, { text: "anything" }),
    ).rejects.toBeInstanceOf(StoreBusyError);
    expect(reads).toBe(3);
  });
});
