import { expect, test } from "bun:test";
import { isCompiledEntrypoint } from "./build-identity";

test("compiled entrypoint detection covers both Bun roots and Windows separators", () => {
  for (const path of [
    "/$bunfs/root/lore",
    "B:/~BUN/root/lore",
    "B:\\~BUN\\root\\lore",
    "C:\\$bunfs\\root\\lore",
  ])
    expect(isCompiledEntrypoint(path)).toBe(true);
  for (const path of [
    "/project/packages/cli/src/main.ts",
    "C:\\project\\main.ts",
    "/project/~BUN/main.ts",
  ])
    expect(isCompiledEntrypoint(path)).toBe(false);
});

test("source build identity includes the independent config package", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { currentBuildIdentity } = await import("./build-identity");
  const root = await mkdtemp(join(tmpdir(), "lore-build-config-"));
  try {
    await Promise.all(
      ["backend", "cli", "config", "engine", "format", "shared"].map(async (name) => {
        await mkdir(join(root, "packages", name, "src"), { recursive: true });
        await writeFile(join(root, "packages", name, "package.json"), JSON.stringify({ name }));
      }),
    );
    await mkdir(join(root, "native", "embedding"), { recursive: true });
    await writeFile(join(root, "bun.lock"), "fixture");
    const source = join(root, "packages", "config", "src", "config.ts");
    await writeFile(source, "export const defaults = 1;");
    const entrypoint = join(root, "packages", "cli", "src", "main.ts");
    const before = await currentBuildIdentity(entrypoint);
    await writeFile(source, "export const defaults = 2;");
    expect(await currentBuildIdentity(entrypoint)).not.toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
