import { expect, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeProjectConfig, loadProjectConfig, resolveProjectPaths } from "./project";

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lorelum-project-config-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loads an optional incremental project layer without writing files", () =>
  fixture(async (root) => {
    expect(await loadProjectConfig(root)).toEqual({ state: "missing", config: {} });

    const paths = resolveProjectPaths(root);
    await mkdir(paths.lorelumDirectory);
    await writeFile(
      paths.configFile,
      "inherit: false\nbase: none\npacks:\n  platform:\n    enabled: true\n    priority: 100\n",
    );

    expect(await loadProjectConfig(root)).toEqual({
      state: "valid",
      config: {
        inherit: false,
        base: "none",
        packs: { platform: { enabled: true, priority: 100 } },
      },
    });
  }));

test("turns damaged or oversized project configuration into a recoverable invalid layer", () =>
  fixture(async (root) => {
    const paths = resolveProjectPaths(root);
    await mkdir(paths.lorelumDirectory);
    await writeFile(paths.configFile, "packs:\n  platform:\n    priority: nope\n");
    expect(await loadProjectConfig(root)).toEqual({ state: "invalid", config: {} });

    await writeFile(paths.configFile, "x".repeat(16_385));
    expect(await loadProjectConfig(root)).toEqual({ state: "invalid", config: {} });
  }));

test("initializes one editable config without overwriting an existing project file", () =>
  fixture(async (root) => {
    const first = await initializeProjectConfig(root, {
      base: "user",
      packs: { platform: { priority: 10 } },
    });
    expect(first.created).toBe(true);
    expect(first.filePath).toBe(join(root, ".lorelum", "config.yaml"));
    expect(await readFile(first.filePath, "utf8")).toContain("platform:");
    if (process.platform !== "win32") {
      expect((await lstat(first.filePath)).mode & 0o777).toBe(0o644);
    }

    const original = "# user content\nbase: none\n";
    await writeFile(first.filePath, original);
    const second = await initializeProjectConfig(root, { inherit: false });
    expect(second).toEqual({ created: false, filePath: first.filePath });
    expect(await readFile(first.filePath, "utf8")).toBe(original);
  }));

test("does not follow a project marker or configuration symlink", async () => {
  if (process.platform === "win32") return;
  await fixture(async (root) => {
    const paths = resolveProjectPaths(root);
    const external = await mkdtemp(join(tmpdir(), "lorelum-project-external-"));
    try {
      await symlink(external, paths.lorelumDirectory);
      expect(await loadProjectConfig(root)).toEqual({ state: "invalid", config: {} });
      await expect(initializeProjectConfig(root)).rejects.toThrow();
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
});
