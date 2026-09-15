import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmbeddingProfile, type EffectivePractice } from "@lorelum/engine";

import { canonicalizePractice } from "../../../../engine/src/local-store/model/canonical-practice";

import { ProjectSemanticRuntime } from "./project-semantic-runtime";
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

test("builds a project semantic artifact during the query wait budget", async () => {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-backend-project-runtime-")),
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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    const runtime = new ProjectSemanticRuntime(
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
      profile,
      {
        maxBatchSize: 8,
        async embed(inputs) {
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

    await expect(
      runtime.query(
        { rootPath: join(root, "store") },
        { projectRoot: root, cacheRoot: cache },
        { text: "incrementally published cache" },
        { maxWaitMs: 1_000, minCoveragePercent: 0 },
      ),
    ).resolves.toMatchObject({
      mode: "semantic",
      coverage: "complete",
      results: [{ practiceId: "platform.query" }],
    });
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("coalesces rapid edits for one directory to the latest semantic target", async () => {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-backend-project-coalesce-")),
    mkdtemp(join(tmpdir(), "lorelum-backend-project-coalesce-cache-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    const firstPath = join(pack, "practices", "first.md");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    for (const [name, id] of [
      ["first", "platform.first"],
      ["second", "platform.second"],
    ] as const) {
      await writeFile(
        join(pack, "practices", `${name}.md`),
        `---\nid: ${id}\ntitle: ${name}\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When coalescing a local target.\n---\n${name}\n`,
      );
    }
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    let documentCalls = 0;
    let releaseFirst!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = new ProjectSemanticRuntime(
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
      profile,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          if (inputs[0]?.startsWith("Practice:")) {
            documentCalls += 1;
            if (documentCalls === 1) await firstBatch;
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
    const request = { projectRoot: root, cacheRoot: cache };
    await expect(
      runtime.query(
        { rootPath: join(root, "store") },
        request,
        { text: "coalesce" },
        { maxWaitMs: 0, minCoveragePercent: 100 },
      ),
    ).resolves.toMatchObject({ state: "indexing" });
    for (let attempt = 0; attempt < 50 && documentCalls !== 1; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- bounded test synchronization.
      await Bun.sleep(5);
    }
    expect(documentCalls).toBe(1);
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
    // The original target yields after its first batch. Its unchanged first
    // projection is reusable, so only the missing second Practice of the
    // latest target is embedded after the edit.
    expect(documentCalls).toBe(2);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("persists each completed ProjectContext batch for restart-safe source reattachment", async () => {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-backend-project-progress-")),
    mkdtemp(join(tmpdir(), "lorelum-backend-project-progress-cache-")),
  ]);
  const runtime = await realpath(
    await mkdtemp(join(tmpdir(), "lorelum-backend-project-progress-runtime-")),
  );
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    for (const id of ["platform.first", "platform.second"]) {
      await writeFile(
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
      );
    }
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let documentCalls = 0;
    const journal = new SemanticOperationJournal(runtime);
    const service = new ProjectSemanticRuntime(
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
      profile,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          documentCalls += inputs.filter((input) => input.startsWith("Practice:")).length;
          if (documentCalls === 2) await second;
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
      { projectRoot: root, cacheRoot: cache },
      { text: "persisted progress" },
      { maxWaitMs: 0, minCoveragePercent: 100 },
    );
    if (!("operationId" in result)) throw new Error("Expected an accepted index operation");
    for (let attempt = 0; attempt < 50 && documentCalls < 2; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- bounded synchronization with the second batch.
      await Bun.sleep(5);
    }
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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let documentBatches = 0;
    const runtime = new ProjectSemanticRuntime(
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
      profile,
      {
        maxBatchSize: 50,
        async embed(inputs) {
          documentBatches += 1;
          if (documentBatches === 2) await second;
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
    const result = await runtime.queryStore(
      { rootPath: "/isolated/store-progress" },
      { cacheRoot: cache },
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
    releaseSecond();
    await runtime.waitForIdle();
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
    for (const root of [first, second]) {
      const pack = join(root, ".lorelum", "packs", "platform");
      await mkdir(join(pack, "practices"), { recursive: true });
      await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
      await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
      await writeFile(
        join(pack, "practices", "shared.md"),
        "---\nid: platform.shared\ntitle: Shared\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When validating shared content addressing.\n---\nSame Practice body.\n",
      );
    }
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    let release!: () => void;
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    let documentCalls = 0;
    const runtime = new ProjectSemanticRuntime(
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
      profile,
      {
        maxBatchSize: 1,
        async embed(inputs) {
          documentCalls += inputs.length;
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
      { projectRoot: first, cacheRoot: cache },
      { text: "shared" },
      policy,
    );
    for (let attempt = 0; attempt < 50 && documentCalls !== 1; attempt += 1) {
      await Bun.sleep(5);
    }
    const secondResult = await runtime.query(
      { rootPath: join(second, "store") },
      { projectRoot: second, cacheRoot: cache },
      { text: "shared" },
      policy,
    );
    expect(firstResult).toMatchObject({ state: "indexing" });
    expect(secondResult).toMatchObject({ state: "indexing" });
    if (!("operationId" in firstResult) || !("operationId" in secondResult)) {
      throw new Error("Expected accepted operations");
    }
    expect(secondResult.operationId).toBe(firstResult.operationId);
    expect(documentCalls).toBe(1);
    release();
    await runtime.waitForIdle();
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});
