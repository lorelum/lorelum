import { expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addRegistryCatalogSource,
  readRegistryCatalog,
  removeRegistryCatalogSource,
  resolveLorelumPaths,
  setRegistryCatalogDefault,
  RegistryCatalogBusyError,
  RegistryCatalogConflictError,
  RegistryCatalogError,
} from "./index";

async function fixture(run: (homeDirectory: string) => Promise<void>): Promise<void> {
  const homeDirectory = await realpath(await mkdtemp(join(tmpdir(), "lorelum-registry-catalog-")));
  try {
    await run(homeDirectory);
  } finally {
    await rm(homeDirectory, { force: true, recursive: true });
  }
}

test("a missing catalog is read-only and selects no saved default", () =>
  fixture(async (homeDirectory) => {
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({ registries: {} });
    await expect(lstat(resolveLorelumPaths(homeDirectory).rootDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }));

test("adds remote and local sources without exposing local paths in catalog shape changes", () =>
  fixture(async (homeDirectory) => {
    const localWorktree = join(homeDirectory, "team-registry");
    const first = await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "ssh://git@git.example.com/platform/packs.git" },
      { homeDirectory },
    );
    expect(first.idempotent).toBe(false);
    const repeated = await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "ssh://git@git.example.com/platform/packs.git" },
      { homeDirectory },
    );
    expect(repeated.idempotent).toBe(true);
    await addRegistryCatalogSource(
      "local-team",
      { kind: "local-git", worktree: localWorktree },
      {
        homeDirectory,
      },
    );

    await expect(
      addRegistryCatalogSource(
        "team",
        { kind: "remote-git", locator: "https://git.example.com/other/packs.git" },
        { homeDirectory },
      ),
    ).rejects.toEqual(new RegistryCatalogConflictError());
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({
      registries: {
        team: { kind: "remote-git", locator: "ssh://git@git.example.com/platform/packs.git" },
        "local-team": { kind: "local-git", worktree: localWorktree },
      },
    });
    const source = await readFile(resolveLorelumPaths(homeDirectory).registryCatalogFile, "utf8");
    expect(source).toContain(localWorktree);
    if (process.platform !== "win32") {
      expect(
        (await lstat(resolveLorelumPaths(homeDirectory).registryCatalogFile)).mode & 0o777,
      ).toBe(0o600);
    }
  }));

test("removing the default atomically restores the built-in official selection", () =>
  fixture(async (homeDirectory) => {
    await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      { homeDirectory },
    );
    expect((await setRegistryCatalogDefault("team", { homeDirectory })).defaultAlias).toBe("team");
    expect(
      (await removeRegistryCatalogSource("team", { homeDirectory })).defaultAlias,
    ).toBeUndefined();
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({ registries: {} });
  }));

test("rejects malformed and symlinked catalog files without following them", () =>
  fixture(async (homeDirectory) => {
    const paths = resolveLorelumPaths(homeDirectory);
    await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      { homeDirectory },
    );
    await writeFile(paths.registryCatalogFile, "schema_version: 1\nregistries: []\n");
    await expect(readRegistryCatalog({ homeDirectory })).rejects.toEqual(
      new RegistryCatalogError(),
    );

    const external = join(homeDirectory, "external.yaml");
    await writeFile(external, "external\n");
    await rm(paths.registryCatalogFile);
    if (process.platform === "win32") return;
    await symlink(external, paths.registryCatalogFile);
    await expect(readRegistryCatalog({ homeDirectory })).rejects.toEqual(
      new RegistryCatalogError(),
    );
    expect(await readFile(external, "utf8")).toBe("external\n");
  }));

test("rejects hand-edited unsafe locators and a non-private catalog directory", () =>
  fixture(async (homeDirectory) => {
    const paths = resolveLorelumPaths(homeDirectory);
    await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      { homeDirectory },
    );
    if (process.platform !== "win32") {
      await chmod(paths.registryCatalogFile, 0o644);
      await expect(readRegistryCatalog({ homeDirectory })).rejects.toEqual(
        new RegistryCatalogError(),
      );
      await chmod(paths.registryCatalogFile, 0o600);
    }
    await writeFile(
      paths.registryCatalogFile,
      "schema_version: 1\nregistries:\n  team:\n    kind: remote-git\n    locator: https://token@git.example.com/team/packs.git\n",
    );
    await expect(readRegistryCatalog({ homeDirectory })).rejects.toEqual(
      new RegistryCatalogError(),
    );
    await expect(
      addRegistryCatalogSource(
        "unsafe",
        { kind: "remote-git", locator: "file:///private/registry" },
        { homeDirectory },
      ),
    ).rejects.toEqual(new RegistryCatalogError());
    if (process.platform === "win32") return;
    await chmod(paths.rootDirectory, 0o755);
    await expect(readRegistryCatalog({ homeDirectory })).rejects.toEqual(
      new RegistryCatalogError(),
    );
  }));

test("preserves the last complete catalog when a mutation cannot write its lock", () =>
  fixture(async (homeDirectory) => {
    if (process.platform === "win32") return;
    const paths = resolveLorelumPaths(homeDirectory);
    await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      { homeDirectory },
    );
    await chmod(paths.rootDirectory, 0o500);
    try {
      await expect(
        addRegistryCatalogSource(
          "other",
          { kind: "remote-git", locator: "https://git.example.com/other/packs.git" },
          { homeDirectory },
        ),
      ).rejects.toEqual(new RegistryCatalogError());
    } finally {
      await chmod(paths.rootDirectory, 0o700);
    }
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({
      registries: {
        team: { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      },
    });
  }));

test("serializes concurrent catalog mutations into one complete document", () =>
  fixture(async (homeDirectory) => {
    const writerCount = 64;
    // Settle every writer before cleaning up, even when lock contention fails.
    const results = await Promise.allSettled(
      Array.from({ length: writerCount }, (_, index) =>
        addRegistryCatalogSource(
          `team-${index}`,
          { kind: "remote-git", locator: `https://git.example.com/team/packs-${index}.git` },
          { homeDirectory },
        ),
      ),
    );
    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    const catalog = await readRegistryCatalog({ homeDirectory });
    expect(Object.keys(catalog.registries).sort()).toEqual(
      Array.from({ length: writerCount }, (_, index) => `team-${index}`).sort(),
    );
  }));

test("returns a bounded busy error without changing a catalog held by another writer", () =>
  fixture(async (homeDirectory) => {
    const paths = resolveLorelumPaths(homeDirectory);
    await addRegistryCatalogSource(
      "team",
      { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      { homeDirectory },
    );
    await writeFile(`${paths.registryCatalogFile}.lock`, "held", { mode: 0o600 });
    await expect(setRegistryCatalogDefault("team", { homeDirectory })).rejects.toEqual(
      new RegistryCatalogBusyError(),
    );
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({
      registries: {
        team: { kind: "remote-git", locator: "https://git.example.com/team/packs.git" },
      },
    });
    await rm(`${paths.registryCatalogFile}.lock`);
    expect((await setRegistryCatalogDefault("team", { homeDirectory })).defaultAlias).toBe("team");
  }));

test("a failed local mutation does not reject or block the next queued writer", () =>
  fixture(async (homeDirectory) => {
    const source = {
      kind: "remote-git" as const,
      locator: "https://git.example.com/team/packs.git",
    };
    const results = await Promise.allSettled([
      addRegistryCatalogSource("team", source, { homeDirectory }),
      addRegistryCatalogSource(
        "team",
        { kind: "remote-git", locator: "https://git.example.com/other/packs.git" },
        { homeDirectory },
      ),
      setRegistryCatalogDefault("team", { homeDirectory }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(results[1]).toMatchObject({ reason: new RegistryCatalogConflictError() });
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({
      defaultAlias: "team",
      registries: { team: source },
    });
    await removeRegistryCatalogSource("team", { homeDirectory });
    expect(await readRegistryCatalog({ homeDirectory })).toEqual({ registries: {} });
  }));

test("a busy catalog does not queue writers to a different catalog", () =>
  fixture((homeDirectory) =>
    fixture(async (otherHomeDirectory) => {
      const source = {
        kind: "remote-git" as const,
        locator: "https://git.example.com/team/packs.git",
      };
      await addRegistryCatalogSource("team", source, { homeDirectory });
      const paths = resolveLorelumPaths(homeDirectory);
      await writeFile(`${paths.registryCatalogFile}.lock`, "held", { mode: 0o600 });
      const completionOrder: string[] = [];
      const results = await Promise.allSettled([
        setRegistryCatalogDefault("team", { homeDirectory }).finally(() => {
          completionOrder.push("busy");
        }),
        addRegistryCatalogSource("team", source, { homeDirectory: otherHomeDirectory }).finally(
          () => {
            completionOrder.push("other");
          },
        ),
      ]);
      expect(results[0]).toMatchObject({
        status: "rejected",
        reason: new RegistryCatalogBusyError(),
      });
      expect(results[1]?.status).toBe("fulfilled");
      expect(completionOrder).toEqual(["other", "busy"]);
    }),
  ));
