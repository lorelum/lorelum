import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
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
import { createVectorExecution, type VectorExecution } from "./profile";
import { resolveVectorRetrievalMethod } from "./methods/catalog";
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
  id: "react.server.request-dedup-cache",
  title: "Deduplicate Request-Scoped Work",
  stage: "server",
  techStack: ["react"],
  appliesWhen:
    "one server render calls the same request-scoped async work, such as session or record lookup, from more than one component or helper",
  body: "Share one cached result for the request instead of repeating the lookup.",
});

const postPractice = detailedPractice({
  id: "issue-pr-etiquette.pull-request.write-the-pr-body-for-a-cold-reviewer",
  title: "Write the PR Body for a Cold Reviewer",
  stage: "pull-request",
  techStack: ["git"],
  appliesWhen:
    "a PR is about to be opened, and the author must write a body from which a reviewer with none of the author's context can verify the change",
  body: "State the problem, the decision and the evidence in the post itself.",
});

const taskRequest =
  "I am opening a PR that fixes a React cache bug; a reviewer will see it without our chat history, so make the context self-contained.";

function nearTieVectors(text: string): readonly number[] {
  if (text.startsWith("I am opening a PR")) return [1, 0, 0];
  if (text.startsWith("a reviewer") || text.startsWith("so make the context")) return [0, 1, 0];
  if (text.startsWith("Deduplicate Request-Scoped Work")) return [0.82, 0.5, 0.2786];
  if (text.startsWith("Write the PR Body for a Cold Reviewer")) return [0.52, 0.82, 0.2392];
  // Query mentions React, so the domain Practice matches the technology world.
  if (text === "react") return [1, 0, 0];
  if (text === "git") return [0, 1, 0];
  if (text.startsWith("Share one cached result")) return [0.82, 0.5, 0.2786];
  if (text.startsWith("State the problem")) return [0.52, 0.82, 0.2392];
  return [0, 1, 0];
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
  execution: VectorExecution,
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
    execution,
    embedding,
  });
  await index.build({ rootPath });
}

function semantic(store: FakeStore, execution: VectorExecution, embedding: EmbeddingPort) {
  return createSemanticQueryService({ store, execution, embedding });
}

function semanticTrace(store: FakeStore, execution: VectorExecution, embedding: EmbeddingPort) {
  return createSemanticCandidateTraceService({ store, execution, embedding });
}

for (const methodId of ["single-vector", "multi-view-vector"] as const) {
  test(`${methodId} returns complete results with deterministic cosine and ID ordering`, async () => {
    await withRoot(async (rootPath) => {
      const store = createStore(rootPath, [
        practice("platform.beta"),
        practice("platform.alpha"),
        practice("platform.alpha2"),
      ]);
      const embedding = port();
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      await build(rootPath, store, execution, embedding);

      const result = await semantic(store, execution, embedding).query(
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
      expect(embedding.calls).toHaveLength(methodId === "single-vector" ? 2 : 3);
    });
  });
}

test("collects N candidates before returning the unchanged top K order", async () => {
  await withRoot(async (rootPath) => {
    const practices = Array.from({ length: 24 }, (_, index) =>
      practice(`platform.item-${String(index).padStart(2, "0")}`),
    );
    const store = createStore(rootPath, practices);
    const embedding = port();
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    const trace = await semanticTrace(store, execution, embedding).query(
      { rootPath },
      { text: "baseline query", candidateWidth: 20, resultLimit: 5 },
    );
    const normal = await semantic(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    const trace = await semanticTrace(store, execution, embedding).query(
      { rootPath },
      { text: "wide query", candidateWidth: 50, resultLimit: 50 },
    );
    const normal = await semantic(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    await expect(
      semanticTrace(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    const result = await semantic(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
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

    const result = await semantic(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    const next = identity(rootPath, 2);
    store.current = next;
    store.changes = {
      identity: next,
      deltas: [{ revision: 2, delta: { added: [], changed: ["platform.only"], invalidated: [] } }],
      currentPractices: [],
    };
    const result = await semantic(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    store.current = identity(rootPath, 3);
    store.changes = undefined;
    await expect(
      semantic(store, execution, embedding).query({ rootPath }, { text: "anything" }),
    ).rejects.toBeInstanceOf(SemanticIndexNotReadyError);
  });
});

test("candidate digest mismatch is a typed query failure", async () => {
  await withRoot(async (rootPath) => {
    const original = practice("platform.only");
    const store = createStore(rootPath, [original]);
    const embedding = port();
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    const invalid = { ...original, contentDigest: "f".repeat(64) };
    store.practices = [invalid];
    await expect(
      semantic(store, execution, embedding).query({ rootPath }, { text: "anything" }),
    ).rejects.toBeInstanceOf(SemanticIndexQueryError);
  });
});

test("a digest mismatch outside the result limit still fails the attempt", async () => {
  await withRoot(async (rootPath) => {
    const domain = detailedPractice({
      id: "domain.overlap",
      title: "domain",
      stage: "implementation",
      techStack: ["typescript"],
      body: "domain",
      appliesWhen: "domain",
    });
    const current = detailedPractice({
      id: "task.current",
      title: "task",
      stage: "implementation",
      techStack: ["typescript"],
      body: "task",
      appliesWhen: "task",
    });
    const store = createStore(rootPath, [domain, current]);
    const embedding = port();
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    const trace = semanticTrace(store, execution, embedding);
    const request = { text: taskRequest, candidateWidth: 2, resultLimit: 1 };
    const clean = await trace.query({ rootPath }, request);
    const lowerRanked = clean.candidateIds.find((id) => id !== clean.finalIds[0])!;
    store.practices = [domain, current].map((item) =>
      item.practiceId === lowerRanked ? { ...item, contentDigest: "f".repeat(64) } : item,
    );
    await expect(trace.query({ rootPath }, request)).rejects.toBeInstanceOf(
      SemanticIndexQueryError,
    );
  });
});

test("discards candidate IDs from a snapshot attempt that is retried", async () => {
  await withRoot(async (rootPath) => {
    const stale = practice("platform.a-stale");
    const retained = [practice("platform.b-retained"), practice("platform.c-retained")];
    const store = createStore(rootPath, [stale, ...retained]);
    const embedding = port();
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
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

    const trace = await semanticTrace(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    let reads = 0;
    store.readEffectivePracticesAtSnapshot = async () => {
      reads += 1;
      throw new StoreSnapshotChangedError();
    };

    await expect(
      semanticTrace(store, execution, embedding).query(
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);
    let reads = 0;
    store.readEffectivePracticesAtSnapshot = async () => {
      reads += 1;
      throw new StoreSnapshotChangedError();
    };
    await expect(
      semantic(store, execution, embedding).query({ rootPath }, { text: "anything" }),
    ).rejects.toBeInstanceOf(StoreBusyError);
    expect(reads).toBe(3);
  });
});

test("decides on applicability and lets guidance and topic settle a near tie", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const execution = createVectorExecution(
      { encodingId, dimensions: 3 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    const taskAware = await semantic(store, execution, embedding).query(
      { rootPath },
      { text: taskRequest, limit: 2 },
    );
    expect(taskAware.results.map((hit) => hit.practiceId)).toEqual([
      postPractice.practiceId,
      domainPractice.practiceId,
    ]);
  });
});

test("candidate and final lists keep one multi-view order inside the requested width", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const execution = createVectorExecution(
      { encodingId, dimensions: 3 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    const trace = await semanticTrace(store, execution, embedding).query(
      { rootPath },
      { text: taskRequest, candidateWidth: 2, resultLimit: 1 },
    );
    expect(trace.candidateIds).toEqual([postPractice.practiceId, domainPractice.practiceId]);
    expect(trace.finalIds).toEqual([postPractice.practiceId]);
  });
});

test("does not linearly reward a Practice for having more body views", async () => {
  await withRoot(async (rootPath) => {
    const oneChunk = practice("platform.a-one-chunk", "One focused paragraph.");
    const manyChunks = practice(
      "platform.z-many-chunks",
      "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
    );
    const store = createStore(rootPath, [manyChunks, oneChunk]);
    const embedding: EmbeddingPort = {
      maxBatchSize: 8,
      async embed(inputs) {
        return {
          encodingId,
          vectors: inputs.map((text) => {
            if (text === "conceptual request") return [1, 0];
            if (text.startsWith("platform.a-one-chunk")) return [0.5, Math.sqrt(1 - 0.5 ** 2)];
            if (text.startsWith("platform.z-many-chunks")) return [0.45, Math.sqrt(1 - 0.45 ** 2)];
            // Identical topic view for both Practices keeps the penalty equal.
            if (text === "typescript") return [0, 1];
            // Every guidance chunk scores the same, so only the number of
            // chunks differs between the two Practices.
            return [0.9, Math.sqrt(1 - 0.9 ** 2)];
          }),
        };
      },
    };
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    const result = await semantic(store, execution, embedding).query(
      { rootPath },
      { text: "conceptual request", limit: 2 },
    );

    expect(result.results.map((hit) => hit.practiceId)).toEqual([
      oneChunk.practiceId,
      manyChunks.practiceId,
    ]);
  });
});

// The query names "React cache", which is the wrong Practice's technology
// world; a lexical scorer would rank it first. Cosine on role views must not.
test("ranks by cosine even when the query shares more words with the wrong Practice", async () => {
  await withRoot(async (rootPath) => {
    const store = createStore(rootPath, [domainPractice, postPractice]);
    const embedding = nearTiePort();
    const execution = createVectorExecution(
      { encodingId, dimensions: 3 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await build(rootPath, store, execution, embedding);

    const service = createSemanticQueryService({ store, execution, embedding });
    const result = await service.query({ rootPath }, { text: taskRequest, limit: 2 });
    expect(result.results.map((hit) => hit.practiceId)).toEqual([
      postPractice.practiceId,
      domainPractice.practiceId,
    ]);
  });
});

for (const methodId of ["single-vector", "multi-view-vector"] as const) {
  test(`${methodId} closes its reader after embedding failure and every snapshot retry`, async () => {
    await withRoot(async (rootPath) => {
      const store = createStore(rootPath, [practice("platform.resource")]);
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      const embedding = port();
      await build(rootPath, store, execution, embedding);
      const close = spyOn(Database.prototype, "close");
      try {
        const failure: EmbeddingPort = {
          maxBatchSize: 1,
          async embed() {
            throw new SemanticIndexQueryError("injected query encoding failure");
          },
        };
        await expect(
          semantic(store, execution, failure).query({ rootPath }, { text: "resource query" }),
        ).rejects.toBeInstanceOf(SemanticIndexQueryError);
        expect(close).toHaveBeenCalledTimes(1);
        close.mockClear();
        const original = store.readEffectivePracticesAtSnapshot;
        let attempts = 0;
        store.readEffectivePracticesAtSnapshot = async (root, expected, ids) => {
          attempts += 1;
          if (attempts === 1) throw new StoreSnapshotChangedError();
          return original(root, expected, ids);
        };
        const result = await semantic(store, execution, embedding).query(
          { rootPath },
          { text: "resource query" },
        );
        expect(result.results.map((hit) => hit.practiceId)).toEqual(["platform.resource"]);
        expect(attempts).toBe(2);
        expect(close).toHaveBeenCalledTimes(2);
      } finally {
        close.mockRestore();
      }
    });
  });
}
