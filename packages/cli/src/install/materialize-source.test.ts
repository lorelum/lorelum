import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { RegistryRelease } from "@lorelum/format";

import { materializeRegistryRelease } from "./materialize-source.js";

async function git(directory: string, arguments_: readonly string[]): Promise<void> {
  const process = Bun.spawn(["git", ...arguments_], {
    cwd: directory,
    stderr: "ignore",
    stdout: "ignore",
  });
  if ((await process.exited) !== 0) throw new Error(`git ${arguments_[0]} failed`);
}

async function createReleaseSource(parent: string): Promise<{
  release: RegistryRelease;
  repository: string;
}> {
  const repository = join(parent, "source-repository");
  await mkdir(join(repository, "packs", "agentic-coding", "practices"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await writeFile(join(repository, "packs", "agentic-coding", "pack.yaml"), "name: fixture\n");
  await chmod(join(repository, "packs", "agentic-coding", "pack.yaml"), 0o755);
  await writeFile(
    join(repository, "packs", "agentic-coding", "practices", "需求.md"),
    "Unicode filenames allowed by the Pack source-path contract.",
  );
  await writeFile(
    join(repository, "packs", "agentic-coding", "ignored.bin"),
    "This source-only file must not be materialized.",
  );
  await chmod(join(repository, "packs", "agentic-coding", "ignored.bin"), 0o755);
  await git(repository, ["add", "."]);
  await git(repository, [
    "-c",
    "user.name=Lorelum Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "test fixture",
  ]);
  await git(repository, ["tag", "agentic-coding-v0.1.0"]);
  return {
    repository: pathToFileURL(repository).href,
    release: {
      version: "0.1.0",
      ref: "agentic-coding-v0.1.0",
      path: "packs/agentic-coding",
    },
  };
}

test("materializes only Pack files from a tagged repository subtree", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lorelum-materialize-test-"));
  try {
    const fixture = await createReleaseSource(parent);
    const source = await materializeRegistryRelease(fixture.release, fixture.repository);
    expect(source.resolvedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(await Bun.file(join(source.directory, "pack.yaml")).text()).toContain("fixture");
    expect(await Bun.file(join(source.directory, "practices", "需求.md")).exists()).toBe(true);
    expect(await Bun.file(join(source.directory, "ignored.bin")).exists()).toBe(false);
    const temporaryRoot = dirname(source.directory);
    await source.cleanup();
    expect(await Bun.file(temporaryRoot).exists()).toBe(false);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("maps a missing release ref to source.unavailable", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lorelum-materialize-test-"));
  try {
    const fixture = await createReleaseSource(parent);
    await expect(
      materializeRegistryRelease({ ...fixture.release, ref: "missing-v9.0.0" }, fixture.repository),
    ).rejects.toMatchObject({ code: "source.unavailable" });
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});
