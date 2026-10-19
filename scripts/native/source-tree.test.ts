import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import config from "../../native/embedding/build-config.json";
import { VerifiedNativePatch } from "./source-tree";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("patch verification rejects modified input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-patch-"));
  const patchPath = join(directory, "native", "embedding", config.patch.path);
  const contents = await readFile(join(repositoryRoot, "native", "embedding", config.patch.path));
  try {
    await mkdir(dirname(patchPath), { recursive: true });
    await writeFile(patchPath, contents);
    VerifiedNativePatch.read(directory);

    await writeFile(patchPath, "corrupted patch");
    expect(() => VerifiedNativePatch.read(directory)).toThrow("patch digest does not match");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
