import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmbeddingProfile } from "../query/semantic";
import { resolveProjectContext } from "./resolver";
import { ProjectSemanticProgressService } from "./semantic-progress";
import { semanticVectorCachePaths } from "./cache";

const encodingId = "b".repeat(64);

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for semantic progress");
}

async function setup(): Promise<{ root: string; cache: string }> {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-project-progress-")),
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

test("publishes each completed ProjectContext vector batch for partial query before ready", async () => {
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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let documentCalls = 0;
    const service = new ProjectSemanticProgressService(snapshot, cache, profile, {
      maxBatchSize: 1,
      async embed(inputs) {
        if (inputs.length === 1 && inputs[0]?.startsWith("Practice:")) {
          documentCalls += 1;
          if (documentCalls === 2) await second;
        }
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    });

    const build = service.build();
    await waitFor(async () => (await service.status()).indexedPracticeCount === 1);
    await expect(service.queryPartial({ text: "incremental project" })).resolves.toMatchObject({
      indexedPracticeCount: 1,
      totalPracticeCount: 2,
      result: { coverage: "partial", results: [{ practiceId: "platform.first" }] },
    });
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
});

test("reuses shared vectors when a new ProjectContext artifact keeps the same projection", async () => {
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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    let initialDocumentCalls = 0;
    await new ProjectSemanticProgressService(first, cache, profile, {
      maxBatchSize: 4,
      async embed(inputs) {
        initialDocumentCalls += inputs.filter((input) => input.startsWith("Practice:")).length;
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    expect(initialDocumentCalls).toBe(2);

    // Severity changes canonical Practice content but is intentionally outside
    // the semantic projection, so the new corpus gets a fresh artifact while
    // its embeddings can be reused by (profileId, projectionDigest).
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
    await new ProjectSemanticProgressService(second, cache, profile, {
      maxBatchSize: 4,
      async embed(inputs) {
        secondDocumentCalls += inputs.filter((input) => input.startsWith("Practice:")).length;
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
});

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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await new ProjectSemanticProgressService(first, cache, profile, {
      maxBatchSize: 4,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();

    const otherEncodingId = "c".repeat(64);
    const otherProfile = createEmbeddingProfile({ encodingId: otherEncodingId, dimensions: 2 });
    let incompatibleProfileEmbeds = 0;
    await new ProjectSemanticProgressService(first, cache, otherProfile, {
      maxBatchSize: 4,
      async embed(inputs) {
        incompatibleProfileEmbeds += inputs.filter((input) => input.startsWith("Practice:")).length;
        return { encodingId: otherEncodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    expect(incompatibleProfileEmbeds).toBe(2);

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
    await new ProjectSemanticProgressService(changed, cache, profile, {
      maxBatchSize: 4,
      async embed(inputs) {
        changedProjectionEmbeds += inputs.filter((input) => input.startsWith("Practice:")).length;
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    expect(changedProjectionEmbeds).toBe(1);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("a forced rebuild failure keeps the prior ready artifact queryable", async () => {
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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await new ProjectSemanticProgressService(snapshot, cache, profile, {
      maxBatchSize: 4,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    const vectors = semanticVectorCachePaths(cache);
    await Promise.all([
      rm(vectors.database, { force: true }),
      rm(`${vectors.database}-wal`, { force: true }),
      rm(`${vectors.database}-shm`, { force: true }),
    ]);
    const replacement = new ProjectSemanticProgressService(snapshot, cache, profile, {
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
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});
