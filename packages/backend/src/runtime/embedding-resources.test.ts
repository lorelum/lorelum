import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCompiledEmbeddingResourceRoot, verifyResource } from "./embedding-resources";

test("compiled resource lookup resolves the executable symlink before finding native files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-resource-root-"));
  try {
    const installed = join(directory, "installed");
    const bin = join(directory, "bin");
    await mkdir(installed, { recursive: true });
    await mkdir(bin);
    const executable = join(installed, "lore");
    const link = join(bin, "lore");
    await writeFile(executable, "fixture");
    await symlink(executable, link);

    await expect(resolveCompiledEmbeddingResourceRoot(link)).resolves.toBe(
      await realpath(installed),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resource verification rejects wrong content and detects replacement after hashing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-resource-"));
  const path = join(directory, "model");
  const digest = createHash("sha256").update("fixture").digest("hex");
  try {
    await writeFile(path, "fixture");
    const unchanged = await verifyResource(path, 7, digest, AbortSignal.timeout(1000));
    await unchanged();
    await expect(verifyResource(path, 6, digest, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "embedding.resource-invalid",
    });
    await expect(
      verifyResource(path, 7, "0".repeat(64), AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "embedding.resource-invalid" });
    await writeFile(path, "changed");
    await expect(unchanged()).rejects.toMatchObject({ code: "embedding.resource-invalid" });
    await rm(path);
    const target = join(directory, "target");
    await writeFile(target, "fixture");
    await symlink(target, path);
    await expect(verifyResource(path, 7, digest, AbortSignal.timeout(1000))).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
