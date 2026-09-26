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
import { KeywordIndexUnavailableError } from "../errors";
import { SemanticIndexNotReadyError, SemanticIndexQueryError } from "./errors";
import { createSemanticIndexService } from "./index/service";
import { createEmbeddingProfile } from "./profile";
import { createSemanticCandidateTraceService, createSemanticQueryService } from "./query-service";

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

function detailedPractice(input: {
  readonly id: string;
  readonly title: string;
  readonly stage: string;
  readonly techStack: readonly string[];
  readonly appliesWhen: string;
  readonly body: string;
}): EffectivePractice {
  const canonical = canonicalizePractice({
    id: input.id,
    title: input.title,
    stage: input.stage,
    tech_stack: [...input.techStack],
    applies_when: input.appliesWhen,
    body: input.body,
    severity: "warn",
  });
  return { practiceId: input.id, ...canonical, sources: [] };
}

const domainPractice = detailedPractice({
  id: "sample.throughput",
  title: "Measure throughput",
  stage: "performance",
  techStack: ["database"],
  appliesWhen: "Measure throughput during sustained traffic.",
  body: "Inspect latency and capacity.",
});
const postPractice = detailedPractice({
  id: "sample.rollback",
  title: "Audit rollback",
  stage: "review",
  techStack: ["database"],
  appliesWhen: "Audit rollback before approving deployment.",
  body: "Inspect recovery procedures.",
});
const taskRequest = "Audit rollback";

/** The domain Practice is the closer vector; only final ordering can promote the task match. */
function nearTieVectors(text: string): readonly number[] {
  if (text.includes(domainPractice.practiceId)) return [0.9, Math.sqrt(1 - 0.9 ** 2)];
  if (text.includes(postPractice.practiceId)) return [0.88, Math.sqrt(1 - 0.88 ** 2)];
  return [1, 0];
}

function nearTiePort(): EmbeddingPort {
  return {
    maxBatchSize: 8,
    async embed(inputs) {
      return { encodingId, vectors: inputs.map(nearTieVectors) };
    },
  };
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

function semanticTrace(
  store: FakeStore,
  profile: ReturnType<typeof createEmbeddingProfile>,
  embedding: EmbeddingPort,
) {
  return createSemanticCandidateTraceService({ store, profile, embedding });
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

test("collects N candidates before returning the unchanged top K order", async () => {
  await withRoot(async (rootPath) => {
    const practices = Array.from({ length: 24 }, (_, index) =>
      practice(`platform.item-${String(index).padStart(2, "0")}`),
    );
    const store = createStore(rootPath, practices);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);

    const trace = await semanticTrace(store, profile, embedding).query(
      { rootPath },
      { text: "baseline query", candidateWidth: 20, resultLimit: 5 },
    );
    const normal = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: "baseline query", limit: 5 },
    );

    expect(trace.candidateIds).toHaveLength(20);
    expect(trace.finalIds).toHaveLength(5);
    expect(trace.finalIds).toEqual(trace.candidateIds.slice(0, 5));
    expect(normal.results.map((hit) => hit.practiceId)).toEqual([...trace.finalIds]);
    expect(Object.keys(normal).sort()).toEqual(["coverage", "mode", "profileId", "results"]);
    expect(trace.candidateIds).toEqual(
      Array.from({ length: 20 }, (_, index) => `platform.item-${String(index).padStart(2, "0")}`),
    );
  });
});

test("candidate width grows with K when K exceeds the ordinary minimum", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(
      rootPath,
      Array.from({ length: 53 }, (_, index) =>
        practice(`platform.item-${String(index).padStart(2, "0")}`),
      ),
    );
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);

    const trace = await semanticTrace(store, profile, embedding).query(
      { rootPath },
      { text: "wide query", candidateWidth: 50, resultLimit: 50 },
    );
    const normal = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: "wide query", limit: 50 },
    );

    expect(trace.candidateIds).toHaveLength(50);
    expect(trace.finalIds).toHaveLength(50);
    expect(normal.results.map((hit) => hit.practiceId)).toEqual([...trace.finalIds]);
  });
});

test("rejects an internal benchmark window when K is wider than N", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [practice("platform.only")]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);

    await expect(
      semanticTrace(store, profile, embedding).query(
        { rootPath },
        { text: "invalid window", candidateWidth: 1, resultLimit: 2 },
      ),
    ).rejects.toThrow("Semantic candidate width must be at least the result limit");
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

test("discards candidate IDs from a snapshot attempt that is retried", async () => {
  await withRoot(async (rootPath) => {
    const stale = practice("platform.a-stale");
    const retained = [practice("platform.b-retained"), practice("platform.c-retained")];
    const store = createStore(rootPath, [stale, ...retained]);
    const embedding = port();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    const readAtSnapshot = store.readEffectivePracticesAtSnapshot;
    let reads = 0;
    store.readEffectivePracticesAtSnapshot = async (root, expected, ids) => {
      reads += 1;
      if (reads === 1) {
        const next = identity(rootPath, 2);
        store.current = next;
        store.practices = retained;
        store.changes = {
          identity: next,
          deltas: [
            { revision: 2, delta: { added: [], changed: [stale.practiceId], invalidated: [] } },
          ],
          currentPractices: retained,
        };
      }
      return readAtSnapshot(root, expected, ids);
    };

    const trace = await semanticTrace(store, profile, embedding).query(
      { rootPath },
      { text: "retry query", candidateWidth: 20, resultLimit: 1 },
    );

    expect(reads).toBe(2);
    expect(trace.candidateIds).toEqual(["platform.b-retained", "platform.c-retained"]);
    expect(trace.candidateIds).not.toContain(stale.practiceId);
    expect(trace.finalIds).toEqual(["platform.b-retained"]);
  });
});
test("benchmark trace fails without returning IDs when every snapshot attempt changes", async () => {
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
      semanticTrace(store, profile, embedding).query(
        { rootPath },
        { text: "retry failure", candidateWidth: 20, resultLimit: 1 },
      ),
    ).rejects.toBeInstanceOf(StoreBusyError);
    expect(reads).toBe(3);
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

test("orders final results by task relevance over the closer domain match", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);

    const taskAware = await semantic(store, profile, embedding).query(
      { rootPath },
      { text: taskRequest, limit: 2 },
    );
    expect(taskAware.results.map((hit) => hit.practiceId)).toEqual([
      postPractice.practiceId,
      domainPractice.practiceId,
    ]);

    const semanticOnly = await createSemanticCandidateTraceService({
      store,
      profile,
      embedding,
      taskSignal: { measure: () => new Map<string, number>() },
    }).query({ rootPath }, { text: taskRequest, candidateWidth: 2, resultLimit: 2 });
    expect(semanticOnly.finalIds).toEqual([domainPractice.practiceId, postPractice.practiceId]);
  });
});

test("candidate trace keeps reader order while final results use task ordering", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);

    const trace = await semanticTrace(store, profile, embedding).query(
      { rootPath },
      { text: taskRequest, candidateWidth: 2, resultLimit: 1 },
    );
    expect(trace.candidateIds).toEqual([domainPractice.practiceId, postPractice.practiceId]);
    expect(trace.finalIds).toEqual([postPractice.practiceId]);
  });
});

test("trace fails instead of returning another order when task scoring is unavailable", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    const service = createSemanticCandidateTraceService({
      store,
      profile,
      embedding,
      taskSignal: {
        measure() {
          throw new KeywordIndexUnavailableError();
        },
      },
    });
    await expect(
      service.query({ rootPath }, { text: taskRequest, candidateWidth: 2, resultLimit: 2 }),
    ).rejects.toBeInstanceOf(SemanticIndexQueryError);
  });
});

test("digest mismatch is rejected before the task signal sees candidates", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await build(rootPath, store, profile, embedding);
    store.practices = [domainPractice, { ...postPractice, contentDigest: "f".repeat(64) }];
    let measured = false;
    const service = createSemanticCandidateTraceService({
      store,
      profile,
      embedding,
      taskSignal: {
        measure() {
          measured = true;
          return new Map<string, number>();
        },
      },
    });
    await expect(
      service.query({ rootPath }, { text: taskRequest, candidateWidth: 2, resultLimit: 1 }),
    ).rejects.toBeInstanceOf(SemanticIndexQueryError);
    expect(measured).toBe(false);
  });
});
