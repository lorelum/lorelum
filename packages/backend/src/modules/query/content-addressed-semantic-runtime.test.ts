import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createVectorExecution,
  resolveVectorRetrievalMethod,
  type EffectivePractice,
} from "@lorelum/engine";

import { canonicalizePractice } from "../../../../engine/src/local-store/model/canonical-practice";
import { createIsolatedProjectSandbox } from "../../../../engine/src/project-context/project-sandbox.test-helper";

import { EmbeddingError } from "../embedding/errors";
import { ContentAddressedSemanticRuntime } from "./content-addressed-semantic-runtime";
import { SemanticOperationJournal } from "./project-operation-journal";

const encodingId = "c".repeat(64);

function storePractice(id: string, body = id): EffectivePractice {
  const canonical = canonicalizePractice({
    id,
    title: id,
    stage: "implementation",
    tech_stack: ["typescript"],
    applies_when: body,
    body,
  });
  return Object.freeze({ practiceId: id, ...canonical, sources: Object.freeze([]) });
}

test("project query starts indexing and reads the completed semantic artifact", async () => {
  const [root, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-backend-project-runtime-"),
    mkdtemp(join(tmpdir(), "lorelum-backend-project-runtime-cache-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(
      join(pack, "practices", "query.md"),
      "---\nid: platform.query\ntitle: Project query\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When querying a project-local Pack.\n---\nUse an incrementally published semantic cache.\n",
    );
    const encoding = { encodingId, dimensions: 2 };
    let releaseEmbedding!: () => void;
    const embeddingGate = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const runtime = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "test-store",
              generation: 0,
              effectiveRevision: 0,
              manifestDigest: "0".repeat(64),
            },
            practices: [],
          };
        },
      },
      encoding,
      {
        maxBatchSize: 8,
        async embed(inputs) {
          await embeddingGate;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
    );

    const storageRoot = { rootPath: join(root, "store") };
    const target = { kind: "project" as const, projectRoot: root, cacheRoot: cache };
    const query = { text: "incrementally published cache" };
    const policy = { maxWaitMs: 0, minCoveragePercent: 0 };
    try {
      // Hold publication explicitly; runner speed must not decide the query state.
      await expect(runtime.query(storageRoot, target, query, policy)).resolves.toMatchObject({
        state: "indexing",
        indexedPracticeCount: 0,
        totalPracticeCount: 1,
      });
      releaseEmbedding();
      await runtime.waitForIdle();
      await expect(runtime.query(storageRoot, target, query, policy)).resolves.toMatchObject({
        mode: "semantic",
        coverage: "complete",
        results: [{ practiceId: "platform.query" }],
      });
    } finally {
      releaseEmbedding();
      await runtime.waitForIdle();
    }
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("uses the Store target when automatic semantic discovery reaches the selected Store root", async () => {
  const [home, cache, runtimeDirectory] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-backend-store-boundary-")),
    mkdtemp(join(tmpdir(), "lorelum-backend-store-boundary-cache-")),
    mkdtemp(join(tmpdir(), "lorelum-backend-store-boundary-runtime-")),
  ]);
  const runtime = await realpath(runtimeDirectory);
  try {
    const storeRoot = join(home, ".lorelum");
    const workingDirectory = join(home, "ordinary", "nested");
    await mkdir(join(storeRoot, "packs", "agentic-coding", "artifact"), { recursive: true });
    await mkdir(workingDirectory, { recursive: true });
    await writeFile(join(storeRoot, "config.yaml"), "backend:\n  requestTimeoutMs: 1\n");
    await writeFile(
      join(storeRoot, "packs", "agentic-coding", "artifact", "pack.yaml"),
      "name: agentic-coding\nversion: 1.0.0\n",
    );
    const encoding = { encodingId, dimensions: 2 };
    const journal = new SemanticOperationJournal(runtime);
    const service = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "store-boundary",
              generation: 0,
              effectiveRevision: 0,
              manifestDigest: "0".repeat(64),
            },
            practices: [storePractice("stored.canonical", "canonical Store guidance")],
          };
        },
      },
      encoding,
      {
        maxBatchSize: 8,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 8,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
      journal,
    );
    const request = {
      kind: "project" as const,
      startDirectory: workingDirectory,
      cacheRoot: cache,
    };

    const operation = await service.build({ rootPath: storeRoot }, request);
    if (operation.state !== "queued" && operation.state !== "building") {
      throw new Error("Expected an accepted Store index operation");
    }
    await service.waitForIdle();
    await expect(journal.findById(operation.operationId)).resolves.toMatchObject({
      targetKind: "store",
      state: "ready",
    });

    const result = await service.query(
      { rootPath: storeRoot },
      request,
      { text: "canonical Store guidance" },
      { maxWaitMs: 1_000, minCoveragePercent: 0 },
    );
    expect(result).toMatchObject({
      mode: "semantic",
      coverage: "complete",
      results: [{ practiceId: "stored.canonical" }],
    });
    expect(result).not.toHaveProperty("context");
  } finally {
    await Promise.all([
      rm(home, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
      rm(runtime, { recursive: true, force: true }),
    ]);
  }
});

test("coalesces rapid edits for one directory to the latest semantic target", async () => {
  const [root, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-backend-project-coalesce-"),
    mkdtemp(join(tmpdir(), "lorelum-backend-project-coalesce-cache-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    const firstPath = join(pack, "practices", "first.md");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await Promise.all(
      [
        ["first", "platform.first"],
        ["second", "platform.second"],
      ].map(([name, id]) =>
        writeFile(
          join(pack, "practices", `${name}.md`),
          `---\nid: ${id}\ntitle: ${name}\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When coalescing a local target.\n---\n${name}\n`,
        ),
      ),
    );
    const encoding = { encodingId, dimensions: 2 };
    let documentCalls = 0;
    let markFirstDocumentStarted!: () => void;
    const firstDocumentStarted = new Promise<void>((resolve) => {
      markFirstDocumentStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "test-store",
              generation: 0,
              effectiveRevision: 0,
              manifestDigest: "0".repeat(64),
            },
            practices: [],
          };
        },
      },
      encoding,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          documentCalls += inputs.length;
          if (inputs.some((text) => text.includes("first"))) {
            markFirstDocumentStarted();
            await firstBatch;
          }
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
    );
    const request = {
      kind: "project" as const,
      projectRoot: root,
      cacheRoot: cache,
      retrievalMethod: "multi-view-vector" as const,
    };
    await expect(
      runtime.query(
        { rootPath: join(root, "store") },
        request,
        { text: "coalesce" },
        { maxWaitMs: 0, minCoveragePercent: 100 },
      ),
    ).resolves.toMatchObject({ state: "indexing" });
    await firstDocumentStarted;
    const original = await Bun.file(firstPath).text();
    await writeFile(
      firstPath,
      original.replace("stage: implementation", "stage: implementation\nseverity: critical"),
    );
    await expect(
      runtime.query(
        { rootPath: join(root, "store") },
        request,
        { text: "coalesce" },
        { maxWaitMs: 0, minCoveragePercent: 100 },
      ),
    ).resolves.toMatchObject({ state: "indexing" });
    releaseFirst();
    await runtime.waitForIdle();
    // The original target yields after its first batch. The severity edit is
    // outside the projection, so nothing already embedded is redone: each
    // Practice's task-card and body inputs are embedded exactly once.
    expect(documentCalls).toBe(4);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("persists each completed ProjectContext batch for restart-safe source reattachment", async () => {
  const [root, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-backend-project-progress-"),
    mkdtemp(join(tmpdir(), "lorelum-backend-project-progress-cache-")),
  ]);
  const runtime = await realpath(
    await mkdtemp(join(tmpdir(), "lorelum-backend-project-progress-runtime-")),
  );
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await Promise.all(
      ["platform.first", "platform.second"].map((id) =>
        writeFile(
          join(pack, "practices", `${id}.md`),
          `---
id: ${id}
title: ${id}
stage: implementation
tech_stack:
  - typescript
applies_when: When persisting an incremental target.
---
${id}
`,
        ),
      ),
    );
    const encoding = { encodingId, dimensions: 2 };
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let markSecondDocumentStarted!: () => void;
    const secondDocumentStarted = new Promise<void>((resolve) => {
      markSecondDocumentStarted = resolve;
    });
    const journal = new SemanticOperationJournal(runtime);
    const service = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "test-store",
              generation: 0,
              effectiveRevision: 0,
              manifestDigest: "0".repeat(64),
            },
            practices: [],
          };
        },
      },
      encoding,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          if (inputs.some((text) => text.includes("platform.second"))) {
            markSecondDocumentStarted();
            await second;
          }
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
      journal,
    );
    const result = await service.query(
      { rootPath: join(root, "store") },
      { kind: "project", projectRoot: root, cacheRoot: cache },
      { text: "persisted progress" },
      { maxWaitMs: 0, minCoveragePercent: 100 },
    );
    if (!("operationId" in result)) throw new Error("Expected an accepted index operation");
    await secondDocumentStarted;
    await expect(journal.findById(result.operationId)).resolves.toMatchObject({
      state: "building",
      indexedPracticeCount: 1,
      totalPracticeCount: 2,
    });
    releaseSecond();
    await service.waitForIdle();
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
      rm(runtime, { recursive: true, force: true }),
    ]);
  }
});

test("queries only the 50 current Store Practices published by incremental progress", async () => {
  const cache = await mkdtemp(join(tmpdir(), "lorelum-backend-store-progress-cache-"));
  try {
    const practices = Object.freeze(
      Array.from({ length: 100 }, (_value, index) =>
        storePractice(`platform.${String(index).padStart(3, "0")}`, `Store Practice ${index}`),
      ),
    );
    const encoding = { encodingId, dimensions: 2 };
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let queryEmbeddings = 0;
    const runtime = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "store-progress",
              generation: 1,
              effectiveRevision: 1,
              manifestDigest: "0".repeat(64),
            },
            practices,
          };
        },
      },
      encoding,
      {
        maxBatchSize: 50,
        async embed(inputs) {
          if (inputs.some((text) => /platform\.0[5-9]\d/.test(text))) await second;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          queryEmbeddings += 1;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
    );
    const result = await runtime.query(
      { rootPath: "/isolated/store-progress" },
      { kind: "store", cacheRoot: cache },
      { text: "Store Practice", limit: 50 },
      { maxWaitMs: 1_000, minCoveragePercent: 0 },
    );
    expect(result).toMatchObject({
      mode: "semantic",
      coverage: "partial",
      indexedPracticeCount: 50,
      totalPracticeCount: 100,
    });
    if (!("results" in result)) throw new Error("Expected semantic results");
    expect(result.results).toHaveLength(50);
    expect(result.results.every((item) => Number(item.practiceId.slice(-3)) < 50)).toBe(true);
    expect(queryEmbeddings).toBe(1);
    await expect(
      runtime.query(
        { rootPath: "/isolated/store-progress" },
        { kind: "store", cacheRoot: cache },
        { text: "Store Practice", limit: 50 },
        { maxWaitMs: 0, minCoveragePercent: 100 },
      ),
    ).resolves.toMatchObject({ state: "indexing", indexedPracticeCount: 50 });
    expect(queryEmbeddings).toBe(1);
    releaseSecond();
    await runtime.waitForIdle();
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("uses retained Store revision deltas and safely falls back when later history is unavailable", async () => {
  const cache = await mkdtemp(join(tmpdir(), "lorelum-backend-store-delta-cache-"));
  try {
    const first = Object.freeze([
      storePractice("platform.unchanged", "Keep this projection"),
      storePractice("platform.changed", "Original projection"),
    ]);
    const second = Object.freeze([
      first[0]!,
      storePractice("platform.changed", "Changed projection"),
    ]);
    const third = Object.freeze([first[0]!, storePractice("platform.changed", "Third projection")]);
    let revision = 1;
    let practices: readonly EffectivePractice[] = first;
    const deltaReads: number[] = [];
    let documentEmbeddings = 0;
    const encoding = { encodingId, dimensions: 2 };
    const runtime = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "store-delta",
              generation: revision,
              effectiveRevision: revision,
              manifestDigest: "0".repeat(64),
            },
            practices,
          };
        },
        async readEffectivePracticeChanges(_root, afterEffectiveRevision) {
          deltaReads.push(afterEffectiveRevision);
          if (afterEffectiveRevision !== 1 || revision !== 2) return undefined;
          return {
            identity: {
              rootBinding: "store-delta",
              generation: 2,
              effectiveRevision: 2,
              manifestDigest: "0".repeat(64),
            },
            deltas: [
              {
                revision: 2,
                delta: { added: [], changed: ["platform.changed"], invalidated: [] },
              },
            ],
            // LocalStore deliberately materializes only revision-touched rows.
            currentPractices: [second[1]!],
          };
        },
      },
      encoding,
      {
        maxBatchSize: 8,
        async embed(inputs) {
          documentEmbeddings += inputs.length;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
    );
    const root = { rootPath: "/isolated/store-delta" };
    const target = {
      kind: "store" as const,
      cacheRoot: cache,
      retrievalMethod: "multi-view-vector" as const,
    };
    const policy = { maxWaitMs: 1_000, minCoveragePercent: 100 };

    await expect(
      runtime.query(root, target, { text: "projection" }, policy),
    ).resolves.toMatchObject({
      mode: "semantic",
      coverage: "complete",
    });
    expect(documentEmbeddings).toBe(4);

    revision = 2;
    practices = second;
    const updated = await runtime.query(root, target, { text: "changed" }, policy);
    expect(updated).toMatchObject({ mode: "semantic", coverage: "complete" });
    if (!("results" in updated)) throw new Error("Expected a semantic query result");
    expect(updated.results.map((result) => result.practiceId)).toContain("platform.changed");
    expect(deltaReads).toEqual([1]);
    // applies_when and body both change, so the task-card and body views are new.
    expect(documentEmbeddings).toBe(6);

    // Revision 3 intentionally has no retained history. The runtime must not
    // return the copied revision-2 row as the current winner; it falls back to
    // the generic current-corpus seed and embeds the new projection once.
    revision = 3;
    practices = third;
    const recovered = await runtime.query(root, target, { text: "third" }, policy);
    expect(recovered).toMatchObject({ mode: "semantic", coverage: "complete" });
    if (!("results" in recovered)) throw new Error("Expected a semantic query result");
    expect(recovered.results).toContainEqual(
      expect.objectContaining({
        practiceId: "platform.changed",
        contentDigest: third[1]!.contentDigest,
      }),
    );
    // A bounded predecessor lookup may try the immediately preceding revision
    // and one older catalog entry before it gives up on unavailable history.
    expect(deltaReads).toEqual([1, 2, 1]);
    // The task-card and body views of the changed Practice are missing;
    // the unchanged Practice still hits the vector cache.
    expect(documentEmbeddings).toBe(8);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("joins one content-addressed operation for equivalent ordinary directories", async () => {
  const [first, second, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-backend-equivalent-first-")),
    mkdtemp(join(tmpdir(), "lorelum-backend-equivalent-second-")),
    mkdtemp(join(tmpdir(), "lorelum-backend-equivalent-cache-")),
  ]);
  try {
    await Promise.all(
      [first, second].map(async (root) => {
        const pack = join(root, ".lorelum", "packs", "platform");
        await mkdir(join(pack, "practices"), { recursive: true });
        await Promise.all([
          writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n"),
          writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n"),
          writeFile(
            join(pack, "practices", "shared.md"),
            "---\nid: platform.shared\ntitle: Shared\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When validating shared content addressing.\n---\nSame Practice body.\n",
          ),
        ]);
      }),
    );
    const encoding = { encodingId, dimensions: 2 };
    // The default single-vector build is shared across equivalent directories.
    const sharedInputCount = 1;
    let release!: () => void;
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    let documentCalls = 0;
    let markDocumentStarted!: () => void;
    const documentStarted = new Promise<void>((resolve) => {
      markDocumentStarted = resolve;
    });
    const runtime = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "equivalent-project-store",
              generation: 0,
              effectiveRevision: 0,
              manifestDigest: "0".repeat(64),
            },
            practices: [],
          };
        },
      },
      encoding,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          documentCalls += inputs.length;
          markDocumentStarted();
          await block;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        beginModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
        async waitModelPreparation() {
          throw new Error("model preparation should not be needed");
        },
      },
    );
    const policy = { maxWaitMs: 0, minCoveragePercent: 100 };
    const firstResult = await runtime.query(
      { rootPath: join(first, "store") },
      { kind: "project", projectRoot: first, cacheRoot: cache },
      { text: "shared" },
      policy,
    );
    await documentStarted;
    const secondResult = await runtime.query(
      { rootPath: join(second, "store") },
      { kind: "project", projectRoot: second, cacheRoot: cache },
      { text: "shared" },
      policy,
    );
    if (!("operationId" in firstResult) || !("operationId" in secondResult)) {
      release();
      throw new Error("Expected accepted operations");
    }
    release();
    await runtime.waitForIdle();
    expect(firstResult).toMatchObject({ state: "indexing" });
    expect(secondResult).toMatchObject({ state: "indexing" });
    expect(secondResult.operationId).toBe(firstResult.operationId);
    expect(documentCalls).toBe(sharedInputCount);
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("surfaces a persisted model preparation failure until explicit recovery makes a new attempt safe", async () => {
  const [cache, runtimeDirectory] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-backend-terminal-failure-cache-")),
    realpath(await mkdtemp(join(tmpdir(), "lorelum-backend-terminal-failure-runtime-"))),
  ]);
  try {
    const encoding = { encodingId, dimensions: 2 };
    const practices = Object.freeze([storePractice("platform.failed")]);
    let modelReady = false;
    let preparations = 0;
    const journal = new SemanticOperationJournal(runtimeDirectory);
    const runtime = new ContentAddressedSemanticRuntime(
      {
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "terminal-failure-store",
              generation: 1,
              effectiveRevision: 1,
              manifestDigest: "0".repeat(64),
            },
            practices,
          };
        },
      },
      encoding,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          if (!modelReady) throw new EmbeddingError("embedding.not-loaded");
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        maxBatchSize: 1,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      },
      {
        status: () => ({ state: modelReady ? "ready" : "failed" }),
        beginModelPreparation() {
          preparations += 1;
          return {
            preparationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
            status: {
              state: "loading",
              encodingId,
              device: "cpu",
              dimensions: 384,
              threads: 1,
              progress: { phase: "downloading" },
            },
          };
        },
        async waitModelPreparation() {
          if (!modelReady) throw new EmbeddingError("embedding.download-failed");
          return { state: "ready", encodingId, device: "cpu", dimensions: 384, threads: 1 };
        },
      },
      journal,
    );
    const root = { rootPath: "/isolated/terminal-failure-store" };
    const target = { kind: "store" as const, cacheRoot: cache };
    const query = { text: "terminal failure" };

    await expect(
      runtime.query(root, target, query, { maxWaitMs: 1_000, minCoveragePercent: 100 }),
    ).rejects.toMatchObject({ code: "embedding.download-failed" });
    const persisted = (await journal.recover()).find((record) => record.state === "failed");
    expect(persisted).toMatchObject({ error: "embedding.download-failed" });
    if (persisted === undefined) throw new Error("Expected a persisted failed operation");
    await expect(runtime.indexOperation(persisted.operationId)).resolves.toEqual({
      operationId: persisted.operationId,
      state: "failed",
      error: "embedding.download-failed",
    });

    await expect(
      runtime.query(root, target, query, { maxWaitMs: 0, minCoveragePercent: 100 }),
    ).rejects.toMatchObject({ code: "embedding.download-failed" });
    expect(preparations).toBe(1);

    modelReady = true;
    await expect(
      runtime.query(root, target, query, { maxWaitMs: 1_000, minCoveragePercent: 100 }),
    ).resolves.toMatchObject({ mode: "semantic", coverage: "complete" });
  } finally {
    await Promise.all([
      rm(cache, { recursive: true, force: true }),
      rm(runtimeDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("one runtime isolates method artifacts and preserves accepted operation targets on its shared queue", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "lorelum-backend-method-cache-"));
  const journalRoot = await realpath(
    await mkdtemp(join(tmpdir(), "lorelum-backend-method-journal-")),
  );
  const encoding = { encodingId, dimensions: 2 };
  const single = createVectorExecution(encoding, resolveVectorRetrievalMethod("single-vector"));
  const multi = createVectorExecution(encoding, resolveVectorRetrievalMethod("multi-view-vector"));
  const practices = Object.freeze([storePractice("platform.method", "Method-isolated content")]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let documentInputs = 0;
  let activeBatches = 0;
  let maxActiveBatches = 0;
  const queryInputs: string[][] = [];
  const journal = new SemanticOperationJournal(journalRoot);
  const runtime = new ContentAddressedSemanticRuntime(
    {
      async readEffectivePracticeSnapshot() {
        return {
          identity: {
            rootBinding: "methods",
            generation: 1,
            effectiveRevision: 1,
            manifestDigest: "0".repeat(64),
          },
          practices,
        };
      },
    },
    encoding,
    {
      maxBatchSize: 1,
      async embed(inputs) {
        documentInputs += inputs.length;
        activeBatches += 1;
        maxActiveBatches = Math.max(maxActiveBatches, activeBatches);
        markStarted();
        try {
          await gate;
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        } finally {
          activeBatches -= 1;
        }
      },
    },
    {
      maxBatchSize: 8,
      async embed(inputs) {
        queryInputs.push([...inputs]);
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    },
    {
      beginModelPreparation() {
        throw new Error("No preparation expected");
      },
      async waitModelPreparation() {
        throw new Error("No preparation expected");
      },
    },
    journal,
  );
  const root = { rootPath: "/isolated/methods" };
  const singleTarget = { kind: "store" as const, cacheRoot };
  const multiTarget = { ...singleTarget, retrievalMethod: "multi-view-vector" as const };
  const policy = { maxWaitMs: 0, minCoveragePercent: 100 };
  try {
    const original = await runtime.build(root, multiTarget);
    await started;
    const joined = await runtime.build(root, multiTarget);
    expect(joined.operationId).toBe(original.operationId);
    const next = await runtime.build(root, singleTarget);
    expect(next.operationId).not.toBe(original.operationId);
    await expect(runtime.indexStatus(root, singleTarget)).resolves.toMatchObject({
      state: "indexing",
      profileId: single.profile.profileId,
      operationId: next.operationId,
    });
    await expect(runtime.indexStatus(root, multiTarget)).resolves.toMatchObject({
      state: "indexing",
      profileId: multi.profile.profileId,
      operationId: original.operationId,
    });
    await expect(journal.findById(original.operationId)).resolves.toMatchObject({
      state: "building",
      profileId: multi.profile.profileId,
    });
    release();
    await runtime.waitForIdle();
    expect(maxActiveBatches).toBe(1);
    expect(documentInputs).toBe(multi.method.projectDocument(practices[0]!).inputs.length + 1);
    await expect(runtime.indexOperation(original.operationId)).resolves.toMatchObject({
      state: "ready",
      index: { profileId: multi.profile.profileId },
    });
    await expect(runtime.indexOperation(next.operationId)).resolves.toMatchObject({
      state: "ready",
      index: { profileId: single.profile.profileId },
    });
    const query = { text: "First task. Second task." };
    await expect(runtime.query(root, singleTarget, query, policy)).resolves.toMatchObject({
      mode: "semantic",
      coverage: "complete",
      profileId: single.profile.profileId,
      results: [{ practiceId: "platform.method" }],
    });
    expect(queryInputs.at(-1)).toEqual([query.text]);
    await expect(runtime.query(root, multiTarget, query, policy)).resolves.toMatchObject({
      mode: "semantic",
      coverage: "complete",
      profileId: multi.profile.profileId,
      results: [{ practiceId: "platform.method" }],
    });
    expect(queryInputs.at(-1)).toEqual(
      multi.method.projectQuery(query.text).map((input) => input.text),
    );
    await expect(runtime.query(root, singleTarget, query, policy)).resolves.toMatchObject({
      mode: "semantic",
      profileId: single.profile.profileId,
    });
    const reused = await runtime.build(root, singleTarget);
    expect(reused.state).toBe("ready");
    expect(documentInputs).toBe(multi.method.projectDocument(practices[0]!).inputs.length + 1);
    await expect(journal.findById(original.operationId)).resolves.toMatchObject({
      state: "ready",
      profileId: multi.profile.profileId,
    });
    const rebuilt = await runtime.rebuild(root, singleTarget);
    await runtime.waitForIdle();
    await expect(runtime.indexOperation(rebuilt.operationId)).resolves.toMatchObject({
      state: "ready",
      index: { profileId: single.profile.profileId },
    });
    await expect(runtime.indexOperation(original.operationId)).resolves.toMatchObject({
      state: "ready",
      index: { profileId: multi.profile.profileId },
    });
  } finally {
    release();
    await runtime.waitForIdle();
    await Promise.all([
      rm(cacheRoot, { recursive: true, force: true }),
      rm(journalRoot, { recursive: true, force: true }),
    ]);
  }
});
