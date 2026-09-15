import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmbeddingProfile } from "../query/semantic";
import { withProjectArtifactLease } from "./artifact-lease";
import {
  projectCachePaths,
  projectKeywordIndexPaths,
  projectSemanticIndexPaths,
  semanticVectorCachePaths,
} from "./cache";
import { projectCacheStatus, pruneProjectCache } from "./cache-manager";
import { queryProjectContextKeyword } from "./keyword-query";
import { resolveProjectContext } from "./resolver";
import { ProjectSemanticProgressService } from "./semantic-progress";
import { projectSemanticPractice } from "../query/semantic/projection";
import { writeSharedEmbeddingVectors } from "./vector-cache";

const encodingId = "c".repeat(64);

test("reports and explicitly prunes only derived project cache state", async () => {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-project-cache-manager-")),
    mkdtemp(join(tmpdir(), "lorelum-project-cache-manager-root-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    const practicePath = join(pack, "practices", "cache.md");
    const source = `---
id: platform.cache
title: Derived cache hygiene
stage: implementation
tech_stack:
  - typescript
applies_when: When pruning a derived project cache.
---
Keep source data outside the cache.
`;
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(practicePath, source);
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

    await queryProjectContextKeyword(snapshot, cache, { text: "derived cache" });
    await new ProjectSemanticProgressService(snapshot, cache, profile, {
      maxBatchSize: 8,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();

    await expect(projectCacheStatus(cache)).resolves.toMatchObject({
      artifactCount: 2,
      keywordArtifactCount: 1,
      semanticArtifactCount: 1,
      vectorCount: 1,
    });
    await expect(pruneProjectCache(cache)).resolves.toMatchObject({
      removedArtifactCount: 2,
      skippedArtifactCount: 0,
    });
    await expect(access(projectKeywordIndexPaths(cache, snapshot).active)).rejects.toThrow();
    await expect(
      access(projectSemanticIndexPaths(cache, snapshot, profile.profileId).active),
    ).rejects.toThrow();
    expect(await Bun.file(practicePath).text()).toBe(source);
    await expect(projectCacheStatus(cache)).resolves.toMatchObject({
      artifactCount: 0,
      vectorCount: 0,
    });
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("prune preserves a leased partial-query artifact and its shared vectors", async () => {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-project-cache-lease-")),
    mkdtemp(join(tmpdir(), "lorelum-project-cache-lease-root-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(
      join(pack, "practices", "cache.md"),
      `---
id: platform.cache
title: Leased cache
stage: implementation
tech_stack: [typescript]
applies_when: When a partial query is reading an artifact.
---
Keep derived vectors while a reader holds a lease.
`,
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
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    await queryProjectContextKeyword(snapshot, cache, { text: "leased cache" });
    await new ProjectSemanticProgressService(snapshot, cache, profile, {
      maxBatchSize: 8,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();

    let release!: () => void;
    let markLeaseHeld!: () => void;
    const leaseHeld = new Promise<void>((resolve) => {
      markLeaseHeld = resolve;
    });
    const lease = withProjectArtifactLease(
      projectKeywordIndexPaths(cache, snapshot).directory,
      async () => {
        markLeaseHeld();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    await leaseHeld;

    await expect(pruneProjectCache(cache)).resolves.toMatchObject({
      removedArtifactCount: 1,
      skippedArtifactCount: 1,
      removedVectorByteSize: 0,
    });
    await expect(access(projectKeywordIndexPaths(cache, snapshot).active)).resolves.toBeNull();
    release();
    await lease;
    await expect(pruneProjectCache(cache)).resolves.toMatchObject({
      removedArtifactCount: 1,
      skippedArtifactCount: 0,
    });
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("catalog, vectors, and semantic artifacts retain no ProjectContext source path or body", async () => {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-project-cache-private-")),
    mkdtemp(join(tmpdir(), "lorelum-project-cache-private-root-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    const practicePath = join(pack, "practices", "private.md");
    const privateBody = "private project guidance must not enter vector or catalog metadata";
    const source = [
      "---",
      "id: platform.private",
      "title: Private cache metadata",
      "stage: implementation",
      "tech_stack:",
      "  - typescript",
      "applies_when: When verifying cache privacy.",
      "---",
      privateBody,
      "",
    ].join("\n");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(practicePath, source);
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
    await queryProjectContextKeyword(snapshot, cache, { text: "private cache" });
    await new ProjectSemanticProgressService(snapshot, cache, profile, {
      maxBatchSize: 8,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    const document = snapshot.practices[0];
    if (document === undefined) throw new Error("Expected ProjectContext Practice");
    await writeSharedEmbeddingVectors(
      cache,
      profile,
      [projectSemanticPractice(document)],
      [new Float32Array([1, 0])],
    );

    const protectedFiles = [
      projectCachePaths(cache).catalog,
      semanticVectorCachePaths(cache).database,
      projectSemanticIndexPaths(cache, snapshot, profile.profileId).active,
    ];
    for (const path of protectedFiles) {
      // eslint-disable-next-line no-await-in-loop -- each physical SQLite file has an independent privacy assertion.
      const contents = Buffer.from(await Bun.file(path).arrayBuffer()).toString("utf8");
      expect(contents).not.toContain(root);
      expect(contents).not.toContain(practicePath);
      expect(contents).not.toContain(privateBody);
    }
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});
