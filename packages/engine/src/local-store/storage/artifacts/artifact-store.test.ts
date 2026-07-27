import { expect, test } from "bun:test";
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

test("promotion verifies an existing artifact before treating it as idempotent", async () => {
  await withDirectory(async (root) => {
    const staging = join(root, "staging");
    await mkdir(staging);
    await writeFile(join(staging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(staging);
    const target = await promoteArtifact(root, "p-platform", digest, staging);
    expect(target).toContain(digest);
  });
});

test("promotion rejects a digest-mismatched target for lifecycle to handle safely", async () => {
  await withDirectory(async (root) => {
    const firstStaging = join(root, "first-staging");
    await mkdir(firstStaging);
    await writeFile(join(firstStaging, "pack.yaml"), "name: platform\n");
    const digest = await calculateArtifactDigest(firstStaging);
    const target = await promoteArtifact(root, "p-platform", digest, firstStaging);

    await writeFile(join(target, "pack.yaml"), "tampered\n");
    const secondStaging = join(root, "second-staging");
    await mkdir(secondStaging);
    await writeFile(join(secondStaging, "pack.yaml"), "name: platform\n");
    await expect(promoteArtifact(root, "p-platform", digest, secondStaging)).rejects.toThrow(
      "existing artifact digest differs",
    );
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
    const digest = await sealSnapshot(path, createProjection(candidate.pack, candidate.sources));
    expect(await readFile(join(path, ".lorelum", "local-store-projection.json"), "utf8")).toContain(
      '"projectionVersion":1',
    );
    expect(digest).toBe(await calculateArtifactDigest(path));
  });
});
