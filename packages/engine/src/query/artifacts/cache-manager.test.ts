import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createVectorExecution, resolveVectorRetrievalMethod } from "../semantic";
import { withContentArtifactLease } from "./artifact-lease";
import {
  contentArtifactCachePaths,
  contentKeywordIndexPaths,
  contentSemanticIndexPaths,
  contentArtifactVectorCachePaths,
} from "./cache";
import { contentArtifactCacheStatus, pruneContentArtifactCache } from "./cache-manager";
import { queryContentAddressedKeyword } from "../keyword/content-addressed-query";
import { createIsolatedProjectSandbox } from "../../project-context/project-sandbox.test-helper";
import { resolveProjectContext } from "../../project-context/resolver";
import { ContentAddressedSemanticProgressService } from "./semantic-progress";
import { createContentAddressedSemanticServices } from "./semantic";
import { writeSharedEmbeddingVectors } from "./vector-cache";

const encodingId = "c".repeat(64);
const methodIds = ["single-vector", "multi-view-vector"] as const;

test("reports and explicitly prunes only derived project cache state", async () => {
  const [root, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-project-cache-manager-"),
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
    const executions = methodIds.map((methodId) =>
      createVectorExecution({ encodingId, dimensions: 2 }, resolveVectorRetrievalMethod(methodId)),
    );

    await queryContentAddressedKeyword(snapshot, cache, { text: "derived cache" });
    for (const execution of executions) {
      // eslint-disable-next-line no-await-in-loop -- build each method through the shared cache writer.
      await new ContentAddressedSemanticProgressService(snapshot, cache, execution, {
        maxBatchSize: 8,
        async embed(inputs) {
          return { encodingId, vectors: inputs.map(() => [1, 0]) };
        },
      }).build();
    }

    await expect(contentArtifactCacheStatus(cache)).resolves.toMatchObject({
      artifactCount: 3,
      keywordArtifactCount: 1,
      semanticArtifactCount: 2,
      vectorCount: executions.reduce(
        (count, execution) =>
          count +
          snapshot.practices.reduce(
            (total, practice) => total + execution.method.projectDocument(practice).inputs.length,
            0,
          ),
        0,
      ),
    });
    await expect(pruneContentArtifactCache(cache)).resolves.toMatchObject({
      removedArtifactCount: 3,
      skippedArtifactCount: 0,
    });
    await expect(access(contentKeywordIndexPaths(cache, snapshot).active)).rejects.toThrow();
    for (const execution of executions) {
      // eslint-disable-next-line no-await-in-loop -- each method artifact must be pruned.
      await expect(
        access(contentSemanticIndexPaths(cache, snapshot, execution.profile.profileId).active),
      ).rejects.toThrow();
    }
    expect(await Bun.file(practicePath).text()).toBe(source);
    await expect(contentArtifactCacheStatus(cache)).resolves.toMatchObject({
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
    createIsolatedProjectSandbox("lorelum-project-cache-lease-"),
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
    const executions = methodIds.map((methodId) =>
      createVectorExecution({ encodingId, dimensions: 2 }, resolveVectorRetrievalMethod(methodId)),
    );
    const embedding = {
      maxBatchSize: 8,
      async embed(inputs: readonly string[]) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    };
    await queryContentAddressedKeyword(snapshot, cache, { text: "leased cache" });
    for (const execution of executions) {
      // eslint-disable-next-line no-await-in-loop -- build each method through the shared cache writer.
      await new ContentAddressedSemanticProgressService(
        snapshot,
        cache,
        execution,
        embedding,
      ).build();
    }
    const leasedExecution = executions[0];
    if (leasedExecution === undefined) throw new Error("Expected leased method");

    let release!: () => void;
    let markLeaseHeld!: () => void;
    const leaseHeld = new Promise<void>((resolve) => {
      markLeaseHeld = resolve;
    });
    const lease = withContentArtifactLease(
      contentSemanticIndexPaths(cache, snapshot, leasedExecution.profile.profileId).directory,
      async () => {
        markLeaseHeld();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    await leaseHeld;

    await expect(pruneContentArtifactCache(cache)).resolves.toMatchObject({
      removedArtifactCount: 2,
      skippedArtifactCount: 1,
      removedVectorByteSize: 0,
    });
    const retained = createContentAddressedSemanticServices(
      snapshot,
      cache,
      leasedExecution,
      embedding,
    );
    await expect(
      retained.query.query(retained.root, { text: "leased cache" }),
    ).resolves.toMatchObject({
      coverage: "complete",
      results: [{ practiceId: "platform.cache" }],
    });
    await expect(access(contentKeywordIndexPaths(cache, snapshot).active)).rejects.toThrow();
    release();
    await lease;
    await expect(pruneContentArtifactCache(cache)).resolves.toMatchObject({
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
    createIsolatedProjectSandbox("lorelum-project-cache-private-"),
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
    const execution = createVectorExecution(
      { encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    );
    await queryContentAddressedKeyword(snapshot, cache, { text: "private cache" });
    await new ContentAddressedSemanticProgressService(snapshot, cache, execution, {
      maxBatchSize: 8,
      async embed(inputs) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    }).build();
    const document = snapshot.practices[0];
    if (document === undefined) throw new Error("Expected ProjectContext Practice");
    await writeSharedEmbeddingVectors(
      cache,
      execution.profile,
      resolveVectorRetrievalMethod("multi-view-vector").projectDocument(document).inputs,
      resolveVectorRetrievalMethod("multi-view-vector")
        .projectDocument(document)
        .inputs.map(() => new Float32Array([1, 0])),
    );

    const protectedFiles = [
      contentArtifactCachePaths(cache).catalog,
      contentArtifactVectorCachePaths(cache).database,
      contentSemanticIndexPaths(cache, snapshot, execution.profile.profileId).active,
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
