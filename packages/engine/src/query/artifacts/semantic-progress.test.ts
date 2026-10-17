/* eslint-disable no-await-in-loop -- Wait for each progress state and publish fixture documents in order. */
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

import {
  createVectorExecution,
  resolveVectorRetrievalMethod,
  VECTOR_RETRIEVAL_METHOD_IDS,
} from "../semantic";
import type { EffectivePractice } from "../../local-store";
import { createIsolatedProjectSandbox } from "../../project-context/project-sandbox.test-helper";
import { openSqliteConnection } from "../../persistence/database/connection";
import { semanticProgressIndexDatabaseDefinition } from "../../persistence/definitions";
import { semanticIndexMetadata, semanticVectors } from "../../persistence/schemas/semantic-index";
import { resolveProjectContext } from "../../project-context/resolver";
import { ContentAddressedSemanticProgressService } from "./semantic-progress";
import { createContentAddressedSemanticServices } from "./semantic";
import {
  contentArtifactVectorCachePaths,
  contentSemanticArtifactId,
  contentSemanticIndexPaths,
} from "./cache";

const encodingId = "b".repeat(64);
const methodIds = [...VECTOR_RETRIEVAL_METHOD_IDS];

/** Total embedded views for a corpus; keeps these assertions recipe-agnostic. */
function embeddedViewCount(practices: readonly EffectivePractice[]): number {
  return practices.reduce(
    (total, practice) =>
      total +
      resolveVectorRetrievalMethod("multi-view-vector").projectDocument(practice).inputs.length,
    0,
  );
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for semantic progress");
}

async function setup(): Promise<{ root: string; cache: string }> {
  const [root, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-project-progress-"),
    mkdtemp(join(tmpdir(), "lorelum-project-progress-cache-")),
  ]);
  const pack = join(root, ".lorelum", "packs", "platform");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
  for (const id of ["platform.first", "platform.second"]) {
    await writeFile(
      join(pack, "practices", `${id}.md`),
      `---\nid: ${id}\ntitle: ${id}\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When building an incrementally indexed project context.\n---\n${id}\n`,
    );
  }
  return { root, cache };
}

test.each(methodIds)(
  "publishes each completed ProjectContext vector batch for partial query before ready (%s)",
  async (methodId) => {
    const { root, cache } = await setup();
    try {
      const snapshot = await resolveProjectContext({
        startDirectory: root,
        storageRoot: { rootPath: join(root, "store") },
        store: {
          async readEffectivePracticeSnapshot() {
            return { practices: [] };
          },
        },
      });
      if (snapshot === undefined) throw new Error("Expected ProjectContext");
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      let releaseSecond!: () => void;
      const second = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      let queryCalls = 0;
      const documentEmbedding = {
        // maxBatchSize bounds views per embed call. The second Practice's views are
        // held until the first Practice is published and queryable.
        maxBatchSize: 1,
        async embed(inputs: readonly string[]) {
          if (inputs.some((text) => text.includes("platform.second"))) await second;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      };
      const queryEmbedding = {
        maxBatchSize: 1,
        async embed(inputs: readonly string[]) {
          queryCalls += 1;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      };
      const service = new ContentAddressedSemanticProgressService(
        snapshot,
        cache,
        execution,
        documentEmbedding,
        undefined,
        undefined,
        queryEmbedding,
      );

      const build = service.build();
      await waitFor(async () => (await service.status()).indexedPracticeCount === 1);
      const otherExecution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(
          methodId === "single-vector" ? "multi-view-vector" : "single-vector",
        ),
      );
      const other = new ContentAddressedSemanticProgressService(
        snapshot,
        cache,
        otherExecution,
        documentEmbedding,
      );
      await expect(other.status()).resolves.toMatchObject({
        state: "missing",
        indexedPracticeCount: 0,
      });
      await expect(other.queryPartial({ text: "incremental project" })).resolves.toBeUndefined();
      await expect(service.queryPartial({ text: "incremental project" })).resolves.toMatchObject({
        indexedPracticeCount: 1,
        totalPracticeCount: 2,
        result: { coverage: "partial", results: [{ practiceId: "platform.first" }] },
      });
      expect(queryCalls).toBe(1);
      releaseSecond();
      await expect(build).resolves.toEqual({
        state: "ready",
        indexedPracticeCount: 2,
        totalPracticeCount: 2,
      });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(cache, { recursive: true, force: true }),
      ]);
    }
  },
);

test.each(methodIds)(
  "reuses shared vectors when a new ProjectContext artifact keeps the same projection (%s)",
  async (methodId) => {
    const { root, cache } = await setup();
    try {
      const resolve = () =>
        resolveProjectContext({
          startDirectory: root,
          storageRoot: { rootPath: join(root, "store") },
          store: {
            async readEffectivePracticeSnapshot() {
              return { practices: [] };
            },
          },
        });
      const first = await resolve();
      if (first === undefined) throw new Error("Expected ProjectContext");
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      let initialDocumentCalls = 0;
      await new ContentAddressedSemanticProgressService(first, cache, execution, {
        maxBatchSize: 4,
        async embed(inputs) {
          initialDocumentCalls += inputs.length;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      }).build();
      expect(initialDocumentCalls).toBe(
        first.practices.reduce(
          (count, practice) => count + execution.method.projectDocument(practice).inputs.length,
          0,
        ),
      );

      // Severity changes canonical Practice content but is intentionally outside
      // the semantic projection, so the new corpus gets a fresh artifact while
      // its embeddings can be reused by (profileId, inputDigest).
      const firstPractice = join(
        root,
        ".lorelum",
        "packs",
        "platform",
        "practices",
        "platform.first.md",
      );
      const original = await Bun.file(firstPractice).text();
      await writeFile(
        firstPractice,
        original.replace("stage: implementation", "stage: implementation\nseverity: critical"),
      );
      const second = await resolve();
      if (second === undefined) throw new Error("Expected changed ProjectContext");
      expect(second.indexCorpusDigest).not.toBe(first.indexCorpusDigest);

      let secondDocumentCalls = 0;
      await new ContentAddressedSemanticProgressService(second, cache, execution, {
        maxBatchSize: 4,
        async embed(inputs) {
          secondDocumentCalls += inputs.length;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      }).build();
      expect(secondDocumentCalls).toBe(0);
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(cache, { recursive: true, force: true }),
      ]);
    }
  },
);

test("shared vectors never cross an embedding Profile or changed semantic projection", async () => {
  const { root, cache } = await setup();
  try {
    const resolve = () =>
      resolveProjectContext({
        startDirectory: root,
        storageRoot: { rootPath: join(root, "store") },
        store: {
          async readEffectivePracticeSnapshot() {
            return { practices: [] };
          },
        },
      });
    const first = await resolve();
    if (first === undefined) throw new Error("Expected ProjectContext");
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await new ContentAddressedSemanticProgressService(first, cache, execution, {
      maxBatchSize: 4,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();

    const otherEncodingId = "c".repeat(64);
    const otherExecution = createVectorExecution(
      { encodingId: otherEncodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    let incompatibleProfileEmbeds = 0;
    await new ContentAddressedSemanticProgressService(first, cache, otherExecution, {
      maxBatchSize: 4,
      async embed(inputs) {
        incompatibleProfileEmbeds += inputs.length;
        return { encodingId: otherEncodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    expect(incompatibleProfileEmbeds).toBe(embeddedViewCount(first.practices));

    const changedPractice = join(
      root,
      ".lorelum",
      "packs",
      "platform",
      "practices",
      "platform.first.md",
    );
    await writeFile(
      changedPractice,
      `${await Bun.file(changedPractice).text()}changed projection text\n`,
    );
    const changed = await resolve();
    if (changed === undefined) throw new Error("Expected changed ProjectContext");
    let changedProjectionEmbeds = 0;
    await new ContentAddressedSemanticProgressService(changed, cache, execution, {
      maxBatchSize: 4,
      async embed(inputs) {
        changedProjectionEmbeds += inputs.length;
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    // Appending body text adds a second body chunk; the existing first body
    // chunk and the task card are unchanged and reused.
    expect(changedProjectionEmbeds).toBe(1);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test.each(methodIds)(
  "a forced rebuild failure keeps the prior ready artifact queryable (%s)",
  async (methodId) => {
    const { root, cache } = await setup();
    try {
      const snapshot = await resolveProjectContext({
        startDirectory: root,
        storageRoot: { rootPath: join(root, "store") },
        store: {
          async readEffectivePracticeSnapshot() {
            return { practices: [] };
          },
        },
      });
      if (snapshot === undefined) throw new Error("Expected ProjectContext");
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      await new ContentAddressedSemanticProgressService(snapshot, cache, execution, {
        maxBatchSize: 4,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      }).build();
      const vectors = contentArtifactVectorCachePaths(cache);
      await Promise.all([
        rm(vectors.database, { force: true }),
        rm(`${vectors.database}-wal`, { force: true }),
        rm(`${vectors.database}-shm`, { force: true }),
      ]);
      const replacement = new ContentAddressedSemanticProgressService(snapshot, cache, execution, {
        maxBatchSize: 1,
        async embed() {
          throw new Error("replacement embedding failed");
        },
      });
      await expect(replacement.build({ force: true })).rejects.toThrow(
        "replacement embedding failed",
      );
      await expect(replacement.status()).resolves.toEqual({
        state: "ready",
        indexedPracticeCount: 2,
        totalPracticeCount: 2,
      });
      const retained = createContentAddressedSemanticServices(snapshot, cache, execution, {
        maxBatchSize: 4,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      });
      await expect(
        retained.query.query(retained.root, { text: "retained artifact" }),
      ).resolves.toMatchObject({
        coverage: "complete",
        results: [{ practiceId: "platform.first" }, { practiceId: "platform.second" }],
      });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(cache, { recursive: true, force: true }),
      ]);
    }
  },
);

test("cold build embeds document views in calls within the Backend input limit", async () => {
  const { root, cache } = await setup();
  try {
    // Three short Practices project to nine views, more than the Backend's eight-input limit.
    await writeFile(
      join(root, ".lorelum", "packs", "platform", "practices", "platform.third.md"),
      `---\nid: platform.third\ntitle: platform.third\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When building an incrementally indexed project context.\n---\nplatform.third\n`,
    );
    const snapshot = await resolveProjectContext({
      startDirectory: root,
      storageRoot: { rootPath: join(root, "store") },
      store: {
        async readEffectivePracticeSnapshot() {
          return { practices: [] };
        },
      },
    });
    if (snapshot === undefined) throw new Error("Expected ProjectContext");
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    const limit = 8;
    const embedding = {
      maxBatchSize: limit,
      async embed(inputs: readonly string[]) {
        if (inputs.length > limit) throw new Error("embedding.input-invalid");
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    };
    const service = new ContentAddressedSemanticProgressService(
      snapshot,
      cache,
      execution,
      embedding,
      undefined,
      undefined,
      embedding,
    );

    await expect(service.build()).resolves.toEqual({
      state: "ready",
      indexedPracticeCount: 3,
      totalPracticeCount: 3,
    });
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

async function currentSnapshot(root: string) {
  const snapshot = await resolveProjectContext({
    startDirectory: root,
    storageRoot: { rootPath: join(root, "store") },
    store: {
      async readEffectivePracticeSnapshot() {
        return { practices: [] };
      },
    },
  });
  if (snapshot === undefined) throw new Error("Expected ProjectContext");
  return snapshot;
}

test.each(methodIds)(
  "partial coverage excludes Practices missing a required input (%s)",
  async (methodId) => {
    const { root, cache } = await setup();
    try {
      const snapshot = await currentSnapshot(root);
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      let continueBuild = true;
      const embedding = {
        maxBatchSize: 1,
        async embed(inputs: readonly string[]) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      };
      const service = new ContentAddressedSemanticProgressService(
        snapshot,
        cache,
        execution,
        embedding,
        () => continueBuild,
        async () => {
          continueBuild = false;
        },
      );
      await expect(service.build()).resolves.toMatchObject({ indexedPracticeCount: 1 });
      const first = snapshot.practices[0];
      if (first === undefined) throw new Error("Expected first Practice");
      const input = execution.method.projectDocument(first).inputs[0];
      if (input === undefined) throw new Error("Expected required input");
      const connection = openSqliteConnection(
        join(
          contentSemanticIndexPaths(cache, snapshot, execution.profile.profileId).directory,
          "progress.sqlite",
        ),
        semanticProgressIndexDatabaseDefinition.schema,
      );
      try {
        connection.orm
          .delete(semanticVectors)
          .where(
            and(
              eq(semanticVectors.practiceId, first.practiceId),
              eq(semanticVectors.inputKey, input.inputKey),
            ),
          )
          .run();
        // Keep structural row-count metadata consistent so this specifically tests
        // required-input coverage, not generic index-integrity rejection.
        connection.orm
          .update(semanticIndexMetadata)
          .set({
            vectorCount: execution.method.projectDocument(first).inputs.length > 1 ? 1 : 0,
          })
          .run();
      } finally {
        connection.close();
      }
      await expect(service.status()).resolves.toEqual({
        state: "indexing",
        indexedPracticeCount: 0,
        totalPracticeCount: 2,
      });
      await expect(service.queryPartial({ text: "missing input" })).resolves.toBeUndefined();
      await expect(
        new ContentAddressedSemanticProgressService(snapshot, cache, execution, embedding).build(),
      ).resolves.toMatchObject({ state: "ready", indexedPracticeCount: 2 });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(cache, { recursive: true, force: true }),
      ]);
    }
  },
);

test.each(
  methodIds.flatMap((methodId) =>
    (["artifact", "store-delta"] as const).map((kind) => ({ methodId, kind })),
  ),
)(
  "reuses verified predecessor rows without shared vectors ($methodId, $kind)",
  async ({ methodId, kind }) => {
    const { root, cache } = await setup();
    try {
      const first = await currentSnapshot(root);
      const execution = createVectorExecution(
        { encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod(methodId),
      );
      const embedding = {
        maxBatchSize: 1,
        async embed(inputs: readonly string[]) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      };
      await new ContentAddressedSemanticProgressService(first, cache, execution, embedding).build();
      const vectors = contentArtifactVectorCachePaths(cache);
      await Promise.all(
        [vectors.database, `${vectors.database}-wal`, `${vectors.database}-shm`].map((path) =>
          rm(path, { force: true }),
        ),
      );
      const practices = join(root, ".lorelum", "packs", "platform", "practices");
      await rm(join(practices, "platform.second.md"));
      await writeFile(
        join(practices, "platform.third.md"),
        "---\nid: platform.third\ntitle: Third Practice\nstage: implementation\ntech_stack: [typescript]\napplies_when: When extending an indexed corpus.\n---\nNew third Practice body.\n",
      );
      const next = await currentSnapshot(root);
      const embedded: string[] = [];
      const publishedCounts: number[] = [];
      const artifactId = contentSemanticArtifactId(first, execution.profile.profileId);
      const service = new ContentAddressedSemanticProgressService(
        next,
        cache,
        execution,
        {
          maxBatchSize: 1,
          async embed(inputs) {
            embedded.push(...inputs);
            return embedding.embed(inputs);
          },
        },
        undefined,
        async (status) => {
          publishedCounts.push(status.indexedPracticeCount);
        },
        embedding,
        kind === "artifact"
          ? { kind, artifactId }
          : {
              kind,
              artifactId,
              sourceDocumentCount: 2,
              touchedPracticeIds: ["platform.second", "platform.third"],
            },
      );
      await expect(service.build()).resolves.toMatchObject({
        state: "ready",
        indexedPracticeCount: 2,
      });
      const added = next.practices.find((practice) => practice.practiceId === "platform.third");
      if (added === undefined) throw new Error("Expected added Practice");
      expect(embedded).toEqual(
        execution.method.projectDocument(added).inputs.map((input) => input.text),
      );
      expect(publishedCounts[0]).toBe(1);
      const complete = createContentAddressedSemanticServices(next, cache, execution, embedding);
      await expect(
        complete.query.query(complete.root, { text: "current practices" }),
      ).resolves.toMatchObject({
        results: [{ practiceId: "platform.first" }, { practiceId: "platform.third" }],
      });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(cache, { recursive: true, force: true }),
      ]);
    }
  },
);
