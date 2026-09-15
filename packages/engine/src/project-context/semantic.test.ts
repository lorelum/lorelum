import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmbeddingProfile } from "../query/semantic";
import { projectSemanticArtifactId, projectSemanticIndexPaths } from "./cache";
import { resolveProjectContext } from "./resolver";
import { createProjectSemanticServices } from "./semantic";

const encodingId = "a".repeat(64);

async function fixture(run: (root: string, cache: string) => Promise<void>): Promise<void> {
  const [root, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-")),
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-cache-")),
  ]);
  try {
    await run(root, cache);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
}

async function writeProject(root: string): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "platform");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
  await writeFile(
    join(pack, "practices", "semantic.md"),
    "---\nid: platform.semantic\ntitle: Semantic project index\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When building a content addressed semantic index.\n---\nUse one reusable local vector.\n",
  );
}

async function snapshot(root: string) {
  const value = await resolveProjectContext({
    startDirectory: root,
    storageRoot: { rootPath: join(root, "store") },
    store: {
      async readEffectivePracticeSnapshot() {
        return { practices: [] };
      },
    },
  });
  if (value === undefined) throw new Error("Expected ProjectContext");
  return value;
}

test("builds and queries one immutable ProjectContext semantic artifact", () =>
  fixture(async (root, cache) => {
    await writeProject(root);
    const current = await snapshot(root);
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    const calls: string[][] = [];
    const services = createProjectSemanticServices(current, cache, profile, {
      maxBatchSize: 8,
      async embed(inputs) {
        calls.push([...inputs]);
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    });

    await expect(services.index.build(services.root)).resolves.toMatchObject({
      status: { state: "ready", vectorCount: 1 },
    });
    const result = await services.query.query(services.root, { text: "semantic index" });
    expect(result).toMatchObject({
      mode: "semantic",
      coverage: "complete",
      results: [{ practiceId: "platform.semantic" }],
    });
    expect(calls).toHaveLength(2);
    await expect(
      access(projectSemanticIndexPaths(cache, current, profile.profileId).active),
    ).resolves.toBeNull();
    await expect(access(join(root, ".lorelum", "cache"))).rejects.toThrow();
  }));

test("uses one semantic artifact identity for equivalent directory snapshots", async () => {
  const [first, second, cache] = await Promise.all([
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-first-")),
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-second-")),
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-cache-")),
  ]);
  try {
    await Promise.all([writeProject(first), writeProject(second)]);
    const [left, right] = await Promise.all([snapshot(first), snapshot(second)]);
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    expect(projectSemanticArtifactId(left, profile.profileId)).toBe(
      projectSemanticArtifactId(right, profile.profileId),
    );
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});
