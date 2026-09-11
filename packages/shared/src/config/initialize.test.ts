import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, initializeConfig, loadConfig, resolveLorelumPaths } from "./index";

async function fixture(run: (homeDirectory: string) => Promise<void>) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "lorelum-config-init-")));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("resolves one frozen path snapshot without filesystem access", async () => {
  await fixture(async (home) => {
    const paths = resolveLorelumPaths(home);
    expect(paths).toEqual({
      rootDirectory: join(home, ".lorelum"),
      configFile: join(home, ".lorelum", "config.yaml"),
      backendRuntimeDirectory: join(home, ".lorelum", "run", "backend"),
      modelCacheDirectory: join(home, ".lorelum", "models"),
    });
    expect(Object.isFrozen(paths)).toBe(true);
    expect(await readdir(home)).toEqual([]);
  });
});

test("initializes an empty home with private directories and file", () =>
  fixture(async (home) => {
    const result = await initializeConfig({ homeDirectory: home });
    expect(result.created).toBe(true);
    expect(result.filePath).toBe(join(home, ".lorelum", "config.yaml"));
    expect(await loadConfig({ homeDirectory: home })).toEqual({});
    expect((await lstat(join(home, ".lorelum"))).mode & 0o777).toBe(0o700);
    expect((await lstat(result.filePath)).mode & 0o777).toBe(0o600);
    expect((await readFile(result.filePath, "utf8")).startsWith("# Lorelum")).toBe(true);
  }));

test("concurrent initialization publishes exactly one file", () =>
  fixture(async (home) => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        initializeConfig({ homeDirectory: home }, { backend: { requestTimeoutMs: 2000 } }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await loadConfig({ homeDirectory: home })).toEqual({
      backend: { requestTimeoutMs: 2000 },
    });
    expect(
      (await readdir(join(home, ".lorelum"))).filter((name) => name.includes(".tmp-")).length,
    ).toBe(0);
  }));

test("existing valid, empty, comment-only, and corrupt files are never overwritten", () =>
  fixture(async (home) => {
    const paths = resolveLorelumPaths(home);
    await mkdir(paths.rootDirectory, { mode: 0o700 });
    const original = "# keep this comment\nbackend:\n  requestTimeoutMs: 2000\n";
    await writeFile(paths.configFile, original, { mode: 0o640 });
    expect(
      (await initializeConfig({ homeDirectory: home }, { backend: { requestTimeoutMs: 9000 } }))
        .created,
    ).toBe(false);
    expect(await readFile(paths.configFile, "utf8")).toBe(original);
    expect((await lstat(paths.configFile)).mode & 0o777).toBe(0o640);

    await writeFile(paths.configFile, "");
    expect(
      (await initializeConfig({ homeDirectory: home }, { query: { profile: "local" } })).created,
    ).toBe(false);
    expect(await readFile(paths.configFile, "utf8")).toBe("");

    const commentOnly = "# keep this comment\n";
    await writeFile(paths.configFile, commentOnly);
    expect(
      (await initializeConfig({ homeDirectory: home }, { query: { profile: "local" } })).created,
    ).toBe(false);
    expect(await readFile(paths.configFile, "utf8")).toBe(commentOnly);

    await writeFile(paths.configFile, "not: [valid");
    expect(
      (await initializeConfig({ homeDirectory: home }, { query: { profile: "local" } })).created,
    ).toBe(false);
    await expect(loadConfig({ homeDirectory: home })).rejects.toEqual(new ConfigError());
  }));

test("rejects a target symlink without touching its external target", () =>
  fixture(async (home) => {
    const paths = resolveLorelumPaths(home);
    await mkdir(paths.rootDirectory, { mode: 0o700 });
    const external = join(home, "external.yaml");
    await writeFile(external, "# external\n");
    await symlink(external, paths.configFile);
    await expect(initializeConfig({ homeDirectory: home })).rejects.toEqual(new ConfigError());
    expect(await readFile(external, "utf8")).toBe("# external\n");
  }));

test("rejects a symlinked parent and oversized or cyclic initial documents", () =>
  fixture(async (home) => {
    const rootDirectory = join(home, ".lorelum");
    const external = await mkdtemp(join(tmpdir(), "lorelum-external-"));
    try {
      await symlink(external, rootDirectory);
      await expect(initializeConfig({ homeDirectory: home })).rejects.toEqual(new ConfigError());
    } finally {
      await unlink(rootDirectory).catch(() => {});
      await rm(external, { recursive: true, force: true });
    }
    const oversized: Record<string, unknown> = { value: "x".repeat(20_000) };
    await expect(initializeConfig({ homeDirectory: home }, oversized)).rejects.toEqual(
      new ConfigError(),
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(initializeConfig({ homeDirectory: home }, cyclic)).rejects.toEqual(
      new ConfigError(),
    );
  }));

test("read-only load does not initialize paths", () =>
  fixture(async (home) => {
    expect(await loadConfig({ homeDirectory: home })).toEqual({});
    expect(await readdir(home)).toEqual([]);
  }));
