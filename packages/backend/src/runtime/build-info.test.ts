import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentBuildInfo, readBuildProvenance } from "./build-info";

function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function createSourceCheckout(root: string): Promise<string> {
  await Promise.all(
    ["backend", "cli", "config", "engine", "format", "log"].map(async (name) => {
      await mkdir(join(root, "packages", name, "src"), { recursive: true });
      await writeFile(join(root, "packages", name, "package.json"), JSON.stringify({ name }));
    }),
  );
  await mkdir(join(root, "native", "embedding"), { recursive: true });
  await writeFile(join(root, "bun.lock"), "fixture-lock");
  await writeFile(join(root, ".gitignore"), "dist/\n");
  const entrypoint = join(root, "packages", "cli", "src", "main.ts");
  await writeFile(entrypoint, "export {};\n");
  return entrypoint;
}

test("source build info locates Git from its entrypoint and reports only safe provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-build-info-"));
  try {
    const entrypoint = await createSourceCheckout(root);
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);
    const revision = git(root, ["rev-parse", "--verify", "HEAD"]);

    const clean = await currentBuildInfo(entrypoint, "1.2.3");
    expect(clean).toMatchObject({
      toolVersion: "1.2.3",
      revision,
      dirty: false,
      buildKind: "source",
    });
    expect(clean.buildIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(clean)).not.toContain(root);

    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "ignored-output"), "ignored");
    expect(await readBuildProvenance(root, "1.2.3", "compiled")).toMatchObject({
      revision,
      dirty: false,
      buildKind: "compiled",
    });

    await writeFile(join(root, "untracked.txt"), "visible to Git");
    expect(await readBuildProvenance(root, "1.2.3", "source")).toMatchObject({
      revision,
      dirty: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown Git provenance stays null when Git is absent or the directory is not a checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-build-info-no-git-"));
  try {
    expect(await readBuildProvenance(root, "1.2.3", "source")).toEqual({
      toolVersion: "1.2.3",
      revision: null,
      dirty: null,
      buildKind: "source",
    });
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = root;
      expect(await readBuildProvenance(root, "1.2.3", "source")).toEqual({
        toolVersion: "1.2.3",
        revision: null,
        dirty: null,
        buildKind: "source",
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
