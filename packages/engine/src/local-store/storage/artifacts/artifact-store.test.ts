import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPackCandidate } from "../../model";
import { calculateArtifactDigest, promoteArtifact, sealSnapshot } from "./artifact-store";
import { createProjection } from "./projection";

async function withDirectory(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lorelum-artifact-"));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test("artifact digest is stable across file creation order and reacts to raw bytes", async () => {
  await withDirectory(async (path) => {
    const first = join(path, "first");
    const second = join(path, "second");
    await mkdir(join(first, "nested"), { recursive: true });
    await mkdir(join(second, "nested"), { recursive: true });
    await writeFile(join(first, "nested", "b.txt"), "b\r\n");
    await writeFile(join(first, "a.txt"), "a\n");
    await writeFile(join(second, "a.txt"), "a\n");
    await writeFile(join(second, "nested", "b.txt"), "b\r\n");
    expect(await calculateArtifactDigest(first)).toBe(await calculateArtifactDigest(second));
    await writeFile(join(second, "nested", "b.txt"), "b\n");
    expect(await calculateArtifactDigest(first)).not.toBe(await calculateArtifactDigest(second));
  });
});

test("artifact digest handles 20,000 sibling files without recursive stack growth", async () => {
  await withDirectory(async (root) => {
    const snapshot = join(root, "large");
    await mkdir(snapshot);
    const names = Array.from(
      { length: 20_000 },
      (_, index) => `file-${index.toString().padStart(5, "0")}.txt`,
    );
    const batchSize = 500;
    for (let offset = names.length - batchSize; offset >= 0; offset -= batchSize) {
      const batch = names.slice(offset, offset + batchSize);
      // eslint-disable-next-line no-await-in-loop -- bounded batches avoid unbounded pending writes
      await Promise.all(batch.map((name) => writeFile(join(snapshot, name), name)));
    }

    const expected = createHash("sha256");
    for (const name of names) {
      expected.update(name, "utf8");
      expected.update(Buffer.from([0]));
      expected.update(name, "utf8");
      expected.update(Buffer.from([10]));
    }
    expect(await calculateArtifactDigest(snapshot)).toBe(expected.digest("hex"));
  });
}, 30_000);

test("promotion verifies an existing artifact before treating it as idempotent", async () => {
  await withDirectory(async (root) => {
    const staging = join(root, "staging");
    await mkdir(staging);
    await writeFile(join(staging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(staging);
    const result = await promoteArtifact(root, "p-platform", digest, staging);
    expect(result.targetPath).toContain(digest);
    expect(result.stagedSnapshotConsumed).toBe(true);
  });
});

test("promotion rejects a digest-mismatched target for lifecycle to handle safely", async () => {
  await withDirectory(async (root) => {
    const firstStaging = join(root, "first-staging");
    await mkdir(firstStaging);
    await writeFile(join(firstStaging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(firstStaging);
    const target = (await promoteArtifact(root, "p-platform", digest, firstStaging)).targetPath;

    await writeFile(join(target, "pack.yaml"), "tampered\n");
    const secondStaging = join(root, "second-staging");
    await mkdir(secondStaging);
    await writeFile(join(secondStaging, "pack.yaml"), "name: platform\n");
    await expect(promoteArtifact(root, "p-platform", digest, secondStaging)).rejects.toThrow(
      "existing artifact digest differs",
    );
  });
});

test("promotion can replace a corrupt unreferenced target only with explicit authorization", async () => {
  await withDirectory(async (root) => {
    const firstStaging = join(root, "first-staging");
    await mkdir(firstStaging);
    await writeFile(join(firstStaging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(firstStaging);
    const first = await promoteArtifact(root, "p-platform", digest, firstStaging);

    await writeFile(join(first.targetPath, "pack.yaml"), "tampered\n");
    const secondStaging = join(root, "second-staging");
    await mkdir(secondStaging);
    await writeFile(join(secondStaging, "pack.yaml"), "name: platform\n");
    const replacement = await promoteArtifact(root, "p-platform", digest, secondStaging, {
      replaceCorruptTarget: { activeReferences: [] },
    });

    expect(replacement.targetPath).toBe(first.targetPath);
    expect(replacement.stagedSnapshotConsumed).toBe(true);
    expect(await readFile(join(replacement.targetPath, "pack.yaml"), "utf8")).toBe(
      "name: platform\n",
    );
  });
});

test("promotion never replaces a corrupt target still referenced by the active manifest", async () => {
  await withDirectory(async (root) => {
    const firstStaging = join(root, "first-staging");
    await mkdir(firstStaging);
    await writeFile(join(firstStaging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(firstStaging);
    const first = await promoteArtifact(root, "p-platform", digest, firstStaging);

    await writeFile(join(first.targetPath, "pack.yaml"), "tampered\n");
    const secondStaging = join(root, "second-staging");
    await mkdir(secondStaging);
    await writeFile(join(secondStaging, "pack.yaml"), "name: platform\n");
    await expect(
      promoteArtifact(root, "p-platform", digest, secondStaging, {
        replaceCorruptTarget: {
          activeReferences: [{ storageKey: "p-platform", artifactDigest: digest }],
        },
      }),
    ).rejects.toThrow("cannot replace an artifact referenced by the active manifest");
    expect(await readFile(join(first.targetPath, "pack.yaml"), "utf8")).toBe("tampered\n");
  });
});

test("promotion reports that an existing valid target did not consume staging", async () => {
  await withDirectory(async (root) => {
    const firstStaging = join(root, "first-staging");
    await mkdir(firstStaging);
    await writeFile(join(firstStaging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(firstStaging);
    const first = await promoteArtifact(root, "p-platform", digest, firstStaging);

    const secondStaging = join(root, "second-staging");
    await mkdir(secondStaging);
    await writeFile(join(secondStaging, "pack.yaml"), "name: platform\n");
    const second = await promoteArtifact(root, "p-platform", digest, secondStaging);

    expect(second.targetPath).toBe(first.targetPath);
    expect(second.stagedSnapshotConsumed).toBe(false);
    expect(await readFile(join(secondStaging, "pack.yaml"), "utf8")).toBe("name: platform\n");
  });
});

test("artifact digest rejects symbolic links instead of following them", async () => {
  await withDirectory(async (path) => {
    await writeFile(join(path, "outside.txt"), "outside");
    try {
      await symlink(join(path, "outside.txt"), join(path, "linked.txt"));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EPERM")
        return;
      throw error;
    }
    expect(calculateArtifactDigest(path)).rejects.toThrow("symbolic links are not allowed");
  });
});

test("sealing publishes the generated projection before calculating the digest", async () => {
  await withDirectory(async (path) => {
    const { candidate } = createPackCandidate(
      {
        pack: { name: "platform", version: "1.0.0" },
        practices: [],
        decisions: [],
      },
      {},
    );
    const digest = await sealSnapshot(
      path,
      createProjection(candidate.pack, candidate.sources, candidate.decisions),
    );
    expect(await readFile(join(path, ".lorelum", "local-store-projection.json"), "utf8")).toContain(
      '"projectionVersion":2',
    );
    expect(digest).toBe(await calculateArtifactDigest(path));
  });
});
