import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UnvalidatedPackInput } from "@lorelum/format";

import {
  createLocalStore,
  StoreBusyError,
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StoreSnapshotIdentity,
} from "../../../local-store";
import {
  canonicalizePractice,
  createPackCandidate,
  type PackCandidate,
} from "../../../local-store/model";
import type { EmbeddingPort } from "../encoding";
import { SemanticEmbeddingError, SemanticIndexSnapshotChangedError } from "../errors";
import { createVectorExecution } from "../profile";
import { resolveVectorRetrievalMethod, VECTOR_RETRIEVAL_METHOD_IDS } from "../methods/catalog";
import { SEMANTIC_INDEX_VERSION } from "./metadata";
import { createSemanticIndexService, type SemanticIndexDependencies } from "./service";

const encodingId = "a".repeat(64);
const methodIds = [...VECTOR_RETRIEVAL_METHOD_IDS];

function practice(
  id = "example.practice",
  options: { readonly body?: string; readonly severity?: "warn" | "critical" } = {},
): EffectivePractice {
  const canonical = canonicalizePractice({
    id,
    title: "Example Practice",
    stage: "implementation",
    tech_stack: ["typescript"],
    applies_when: "Adding an index",
    body: options.body ?? "Keep canonical content in LocalStore.",
    severity: options.severity ?? "warn",
  });
  return { practiceId: id, ...canonical, sources: [] };
}

function activeIndexPath(rootPath: string, profileId: string): string {
  return join(
    rootPath,
    "indexes",
    "semantic",
    `v${SEMANTIC_INDEX_VERSION}`,
    profileId,
    "active.sqlite",
  );
}

function candidate(
  name: string,
  version: string,
  practices: Record<string, string>,
): PackCandidate {
  const input: UnvalidatedPackInput = {
    pack: { name, version },
    practices: Object.entries(practices).map(([id, body]) => ({
      id,
      title: id,
      stage: "implementation",
      tech_stack: ["typescript"],
      applies_when: "Building an index",
      severity: "warn",
      body,
    })),
    decisions: [],
  };
  const sourcePaths = Object.fromEntries(
    Object.keys(practices).map((id) => [id, `practices/${id.replaceAll(".", "/")}.md`]),
  );
  return createPackCandidate(input, sourcePaths).candidate;
}

function identity(rootPath: string, revision = 1): StoreSnapshotIdentity {
  return Object.freeze({
    rootBinding: `test:${rootPath}`,
    generation: revision,
    effectiveRevision: revision,
    manifestDigest: `${revision}`.padStart(64, "0"),
  });
}

function port(
  implementation: (inputs: readonly string[]) => readonly (readonly number[])[] = (inputs) =>
    inputs.map(() => [1, 0]),
): EmbeddingPort & { readonly calls: readonly string[][] } {
  const calls: string[][] = [];
  return {
    maxBatchSize: 2,
    get calls() {
      return calls;
    },
    async embed(inputs) {
      calls.push([...inputs]);
      return { encodingId, vectors: implementation(inputs) };
    },
  };
}

async function withRoot(run: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-semantic-index-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test("builds an empty index without calling the embedding port", async () => {
  await withRoot(async (rootPath) => {
    const vectorPort = port();
    const current = identity(rootPath);
    const service = createSemanticIndexService({
      execution: createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      ),
      embedding: vectorPort,
      store: {
        async readSnapshotIdentity() {
          return current;
        },
        async readEffectivePracticeSnapshot() {
          return { identity: current, practices: [] };
        },
        async readEffectivePracticeChanges() {
          return undefined;
        },
        async withSnapshotFence(_root, _expected, publish) {
          return publish();
        },
      },
    });

    await expect(service.status({ rootPath })).resolves.toMatchObject({ state: "missing" });
    await expect(service.build({ rootPath })).resolves.toMatchObject({
      built: true,
      status: { state: "ready", vectorCount: 0 },
    });
    expect(vectorPort.calls).toEqual([]);
  });
});

test("binds the active index to the full Store identity and reports stale", async () => {
  await withRoot(async (rootPath) => {
    let current = identity(rootPath);
    const vectorPort = port();
    const service = createSemanticIndexService({
      execution: createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      ),
      embedding: vectorPort,
      store: {
        async readSnapshotIdentity() {
          return current;
        },
        async readEffectivePracticeSnapshot() {
          return { identity: current, practices: [practice()] };
        },
        async readEffectivePracticeChanges() {
          return undefined;
        },
        async withSnapshotFence(_root, _expected, publish) {
          return publish();
        },
      },
    });

    await expect(service.build({ rootPath })).resolves.toMatchObject({
      status: { state: "ready", vectorCount: 1 },
    });
    current = identity(rootPath, 2);
    await expect(service.status({ rootPath })).resolves.toMatchObject({ state: "stale" });
    expect(vectorPort.calls.flat()).toHaveLength(3);
  });
});

test.each(methodIds)("failed rebuild preserves the prior active index (%s)", async (methodId) => {
  await withRoot(async (rootPath) => {
    const current = identity(rootPath);
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod(methodId),
    );
    const store: SemanticIndexDependencies["store"] = {
      async readSnapshotIdentity() {
        return current;
      },
      async readEffectivePracticeSnapshot() {
        return { identity: current, practices: [practice()] };
      },
      async readEffectivePracticeChanges() {
        return undefined;
      },
      async withSnapshotFence(_root, _expected, publish) {
        return publish();
      },
    };
    const initial = createSemanticIndexService({ store, execution, embedding: port() });
    await initial.build({ rootPath });
    const failing = createSemanticIndexService({
      store,
      execution,
      embedding: port(() => [[0, 0]]),
    });

    await expect(failing.rebuild({ rootPath })).rejects.toBeInstanceOf(SemanticEmbeddingError);
    await expect(initial.status({ rootPath })).resolves.toMatchObject({ state: "ready" });
  });
});

test("rejects a build when the Store changes before publication", async () => {
  await withRoot(async (rootPath) => {
    const initial = identity(rootPath);
    const changed = identity(rootPath, 2);
    let identityReads = 0;
    const service = createSemanticIndexService({
      execution: createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      ),
      embedding: port(),
      store: {
        async readSnapshotIdentity() {
          identityReads++;
          return identityReads === 1 ? initial : changed;
        },
        async readEffectivePracticeSnapshot() {
          return { identity: initial, practices: [practice()] };
        },
        async readEffectivePracticeChanges() {
          return undefined;
        },
        async withSnapshotFence() {
          throw new StoreSnapshotChangedError();
        },
      },
    });

    await expect(service.build({ rootPath })).rejects.toBeInstanceOf(
      SemanticIndexSnapshotChangedError,
    );
    await expect(service.status({ rootPath })).resolves.toMatchObject({ state: "missing" });
  });
});

// Windows surfaces a different errno for reads through a non-directory path, so the
// POSIX-only unreadable classification cannot be constructed there.
test.skipIf(process.platform === "win32")(
  "does not mistake an unreadable semantic index path for a missing index",
  async () => {
    await withRoot(async (rootPath) => {
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      );
      const directory = join(rootPath, "indexes", "semantic", `v${SEMANTIC_INDEX_VERSION}`);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, execution.profile.profileId), "not a directory");
      const current = identity(rootPath);
      const service = createSemanticIndexService({
        execution,
        embedding: port(),
        store: {
          async readSnapshotIdentity() {
            return current;
          },
          async readEffectivePracticeSnapshot() {
            return { identity: current, practices: [] };
          },
          async readEffectivePracticeChanges() {
            return undefined;
          },
          async withSnapshotFence(_root, _expected, publish) {
            return publish();
          },
        },
      });

      await expect(service.status({ rootPath })).resolves.toMatchObject({ state: "incompatible" });
    });
  },
);

test("preserves Store availability failures instead of hiding them as index errors", async () => {
  await withRoot(async (rootPath) => {
    const expected = new StoreBusyError("Store mutation is in progress");
    const service = createSemanticIndexService({
      execution: createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      ),
      embedding: port(),
      store: {
        async readSnapshotIdentity() {
          throw expected;
        },
        async readEffectivePracticeSnapshot() {
          throw expected;
        },
        async readEffectivePracticeChanges() {
          throw expected;
        },
        async withSnapshotFence() {
          throw expected;
        },
      },
    });

    await expect(service.build({ rootPath })).rejects.toBe(expected);
  });
});

test.each(methodIds)(
  "incrementally encodes only final added and projection-changed Practices (%s)",
  async (methodId) => {
    await withRoot(async (rootPath) => {
      const first = identity(rootPath, 1);
      const second = identity(rootPath, 2);
      let current = first;
      const original = practice("platform.original");
      const changed = practice("platform.original", { body: "Use the current canonical content." });
      const added = practice("platform.added");
      const vectorPort = port();
      const method = resolveVectorRetrievalMethod(methodId);
      const originalInputs = method.projectDocument(original).inputs;
      const reusableDigests = new Set(originalInputs.map((input) => input.inputDigest));
      const expectedNewInputs = [
        ...method
          .projectDocument(changed)
          .inputs.filter((input) => !reusableDigests.has(input.inputDigest)),
        ...method.projectDocument(added).inputs,
      ];
      const fenceIdentities: StoreSnapshotIdentity[] = [];
      const service = createSemanticIndexService({
        execution: createVectorExecution({ encodingId, dimensions: 2 }, method),
        embedding: vectorPort,
        store: {
          async readSnapshotIdentity() {
            return current;
          },
          async readEffectivePracticeSnapshot() {
            return { identity: first, practices: [original] };
          },
          async readEffectivePracticeChanges(_root, afterRevision) {
            expect(afterRevision).toBe(1);
            return {
              identity: second,
              deltas: [
                {
                  revision: 2,
                  delta: {
                    added: ["platform.added"],
                    changed: ["platform.original"],
                    invalidated: [],
                  },
                },
              ],
              currentPractices: [changed, added],
            };
          },
          async withSnapshotFence(_root, expected, publish) {
            fenceIdentities.push(expected);
            return publish();
          },
        },
      });

      await service.build({ rootPath });
      current = second;
      await expect(service.build({ rootPath })).resolves.toMatchObject({
        built: true,
        status: { state: "ready", vectorCount: 2 },
      });
      expect(vectorPort.calls.flat()).toEqual(
        [...originalInputs, ...expectedNewInputs].map((input) => input.text),
      );
      expect(fenceIdentities).toEqual([first, second]);
    });
  },
);

test("uses LocalStore retained history and publication fence for an actual Pack upgrade", async () => {
  await withRoot(async (rootPath) => {
    const store = createLocalStore();
    const vectorPort = port();
    const service = createSemanticIndexService({
      execution: createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      ),
      embedding: vectorPort,
      store,
    });
    await store.install(
      { rootPath },
      candidate("platform", "1.0.0", { "platform.original": "Keep the original practice." }),
    );
    await service.build({ rootPath });
    await store.upgrade(
      { rootPath },
      candidate("platform", "1.1.0", {
        "platform.original": "Use the upgraded practice.",
        "platform.added": "Add a new practice.",
      }),
    );

    await expect(service.build({ rootPath })).resolves.toMatchObject({
      built: true,
      status: { state: "ready", vectorCount: 2 },
    });
    expect(vectorPort.calls.flat()).toHaveLength(8);
    expect(vectorPort.calls.slice(0, 2).flat()).toHaveLength(3);
    expect(vectorPort.calls.slice(2).flat()).toHaveLength(5);
    await expect(service.status({ rootPath })).resolves.toMatchObject({
      state: "ready",
      vectorCount: 2,
    });
  });
});

test.each(methodIds)(
  "reuses a vector when only non-projected canonical content changes (%s)",
  async (methodId) => {
    await withRoot(async (rootPath) => {
      const first = identity(rootPath, 1);
      const second = identity(rootPath, 2);
      let current = first;
      const original = practice("platform.original", { severity: "warn" });
      const changed = practice("platform.original", { severity: "critical" });
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      const vectorPort = port();
      const service = createSemanticIndexService({
        execution,
        embedding: vectorPort,
        store: {
          async readSnapshotIdentity() {
            return current;
          },
          async readEffectivePracticeSnapshot() {
            return { identity: first, practices: [original] };
          },
          async readEffectivePracticeChanges() {
            return {
              identity: second,
              deltas: [
                {
                  revision: 2,
                  delta: { added: [], changed: ["platform.original"], invalidated: [] },
                },
              ],
              currentPractices: [changed],
            };
          },
          async withSnapshotFence(_root, _expected, publish) {
            return publish();
          },
        },
      });

      await service.build({ rootPath });
      current = second;
      const callsBeforeSecondBuild = vectorPort.calls.length;
      await service.build({ rootPath });
      expect(vectorPort.calls).toHaveLength(callsBeforeSecondBuild);
      const database = new Database(activeIndexPath(rootPath, execution.profile.profileId), {
        readonly: true,
      });
      try {
        expect(database.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({
          count: 4,
        });
        const row = database
          .query("SELECT content_digest FROM semantic_vectors WHERE practice_id = ?")
          .get("platform.original") as { readonly content_digest: string };
        expect(row.content_digest).toBe(changed.contentDigest);
      } finally {
        database.close();
      }
    });
  },
);

test.each(methodIds)(
  "uses a metadata-only incremental publication for source-only Store changes (%s)",
  async (methodId) => {
    await withRoot(async (rootPath) => {
      const first = identity(rootPath, 1);
      const sourceOnly = Object.freeze({
        ...first,
        generation: 2,
        manifestDigest: "2".padStart(64, "0"),
      });
      let current: StoreSnapshotIdentity = first;
      const vectorPort = port();
      const fenceIdentities: StoreSnapshotIdentity[] = [];
      const service = createSemanticIndexService({
        execution: createVectorExecution(
          { encodingId, dimensions: 2 },
          resolveVectorRetrievalMethod(methodId),
        ),
        embedding: vectorPort,
        store: {
          async readSnapshotIdentity() {
            return current;
          },
          async readEffectivePracticeSnapshot() {
            return { identity: first, practices: [practice()] };
          },
          async readEffectivePracticeChanges() {
            return { identity: sourceOnly, deltas: [], currentPractices: [] };
          },
          async withSnapshotFence(_root, expected, publish) {
            fenceIdentities.push(expected);
            return publish();
          },
        },
      });

      await service.build({ rootPath });
      const embeddedBefore = vectorPort.calls.flat().length;
      current = sourceOnly;
      await expect(service.build({ rootPath })).resolves.toMatchObject({
        built: true,
        status: { state: "ready", vectorCount: 1 },
      });
      expect(vectorPort.calls.flat()).toHaveLength(embeddedBefore);
      expect(fenceIdentities).toEqual([first, sourceOnly]);
    });
  },
);

test.each(methodIds)(
  "removes invalidated vectors without loading the embedding port (%s)",
  async (methodId) => {
    await withRoot(async (rootPath) => {
      const first = identity(rootPath, 1);
      const second = identity(rootPath, 2);
      let current = first;
      const vectorPort = port();
      const service = createSemanticIndexService({
        execution: createVectorExecution(
          { encodingId, dimensions: 2 },
          resolveVectorRetrievalMethod(methodId),
        ),
        embedding: vectorPort,
        store: {
          async readSnapshotIdentity() {
            return current;
          },
          async readEffectivePracticeSnapshot() {
            return { identity: first, practices: [practice()] };
          },
          async readEffectivePracticeChanges() {
            return {
              identity: second,
              deltas: [
                {
                  revision: 2,
                  delta: { added: [], changed: [], invalidated: ["example.practice"] },
                },
              ],
              currentPractices: [],
            };
          },
          async withSnapshotFence(_root, _expected, publish) {
            return publish();
          },
        },
      });

      await service.build({ rootPath });
      const embeddedBefore = vectorPort.calls.flat().length;
      current = second;
      await expect(service.build({ rootPath })).resolves.toMatchObject({
        built: true,
        status: { state: "ready", vectorCount: 0 },
      });
      expect(vectorPort.calls.flat()).toHaveLength(embeddedBefore);
    });
  },
);

test("falls back to a full build when retained Store history is unavailable", async () => {
  await withRoot(async (rootPath) => {
    const first = identity(rootPath, 1);
    const second = identity(rootPath, 2);
    let current = first;
    const original = practice("platform.original");
    const added = practice("platform.added");
    const vectorPort = port();
    let snapshots = 0;
    const service = createSemanticIndexService({
      execution: createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("multi-view-vector"),
      ),
      embedding: vectorPort,
      store: {
        async readSnapshotIdentity() {
          return current;
        },
        async readEffectivePracticeSnapshot() {
          snapshots++;
          return current === first
            ? { identity: first, practices: [original] }
            : { identity: second, practices: [original, added] };
        },
        async readEffectivePracticeChanges() {
          return undefined;
        },
        async withSnapshotFence(_root, _expected, publish) {
          return publish();
        },
      },
    });

    await service.build({ rootPath });
    current = second;
    await expect(service.build({ rootPath })).resolves.toMatchObject({
      built: true,
      status: { state: "ready", vectorCount: 2 },
    });
    expect(snapshots).toBe(2);
    expect(vectorPort.calls.flat()).toHaveLength(9);
    expect(vectorPort.calls.slice(2).flat()).toHaveLength(6);
  });
});
