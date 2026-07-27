import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PackValidationError } from "../../model";
import { decodeSnapshot } from "./snapshot-codec";

async function withSnapshot(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lorelum-snapshot-"));
  try {
    await mkdir(join(path, "practices"));
    await writeFile(join(path, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(
      join(path, "practices", "api.md"),
      "---\nid: platform.api\ntitle: API\nstage: api\ntech_stack: [typescript]\napplies_when: always\n---\nUse APIs.\n",
    );
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test("SnapshotCodec injects Markdown body and normalizes source paths", async () => {
  await withSnapshot(async (path) => {
    const decoded = await decodeSnapshot(path);
    expect(decoded.candidate.sources[0]?.sourcePath).toBe("practices/api.md");
    expect(decoded.candidate.sources[0]?.canonicalPractice.practice.body).toBe("Use APIs.\n");
  });
});

test("SnapshotCodec rejects a decisions wrapper object", async () => {
  await withSnapshot(async (path) => {
    await writeFile(join(path, "decisions.yaml"), "decisions: []\n");
    expect(decodeSnapshot(path)).rejects.toThrow("top-level sequence");
  });
});

test("SnapshotCodec delegates duplicate Practice ids to the format validation gate", async () => {
  await withSnapshot(async (path) => {
    await writeFile(
      join(path, "practices", "duplicate.md"),
      "---\nid: platform.api\ntitle: Duplicate\nstage: api\ntech_stack: [typescript]\napplies_when: always\n---\nDuplicate.\n",
    );
    await expect(decodeSnapshot(path)).rejects.toBeInstanceOf(PackValidationError);
  });
});

test("SnapshotCodec rejects a symbolic pack manifest before parsing it", async () => {
  await withSnapshot(async (path) => {
    const manifestPath = join(path, "pack.yaml");
    const outsidePath = join(path, "outside-pack.yaml");
    await writeFile(outsidePath, "name: platform\nversion: 1.0.0\n");
    await rm(manifestPath);
    try {
      await symlink(outsidePath, manifestPath);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EPERM")
        return;
      throw error;
    }

    await expect(decodeSnapshot(path)).rejects.toThrow("symbolic links are not allowed");
  });
});
