import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  PackSchema,
  PracticeSchema,
  parseFrontmatter,
  type PackInput,
  type Practice,
} from "@lorelum/format";

import {
  InvalidPreparedPackError,
  LocalStore,
  PackUpgradeRequiredError,
  PackValidationError,
  PracticeConflictError,
  defaultStorageRoot,
  storageRoot,
  type PreparedPack,
  type SnapshotCodec,
} from "./index";

function practice(id: string, overrides: Partial<Practice> = {}): Practice {
  return {
    id,
    title: `Title for ${id}`,
    stage: "api-layer",
    tech_stack: ["typescript"],
    applies_when: "building a TypeScript API integration",
    severity: "warn",
    body: `Guidance for ${id}.`,
    ...overrides,
  };
}

function preparedPack(name: string, version: string, practices: readonly Practice[]): PreparedPack {
  const input: PackInput = { pack: { name, version }, practices: [...practices], decisions: [] };
  const files = [
    {
      relativePath: "pack.yaml",
      bytes: new TextEncoder().encode(JSON.stringify(input.pack)),
    },
    ...practices.map((item) => ({
      relativePath: `practices/${item.id}.md`,
      bytes: practiceMarkdown(item),
    })),
  ];
  return {
    input,
    files,
    practiceSourcePaths: new Map(practices.map((item) => [item.id, `practices/${item.id}.md`])),
  };
}

function practiceMarkdown(item: Practice): Uint8Array {
  const { body, ...frontmatter } = item;
  return new TextEncoder().encode(`---\n${JSON.stringify(frontmatter)}\n---\n${body ?? ""}`);
}

function testSnapshotCodec(): SnapshotCodec {
  return {
    async decode(artifactDirectory) {
      const pack = PackSchema.parse(
        JSON.parse(await readFile(join(artifactDirectory, "pack.yaml"), "utf8")) as unknown,
      );
      const practiceDirectory = join(artifactDirectory, "practices");
      const entries = await readdir(practiceDirectory, { withFileTypes: true });
      const decodedPractices = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map(async (entry) => {
            const relativePath = `practices/${entry.name}`;
            const markdown = await readFile(join(practiceDirectory, entry.name), "utf8");
            const parsed = parseFrontmatter(markdown);
            const decodedPractice = PracticeSchema.parse({ ...parsed.data, body: parsed.content });
            return { decodedPractice, relativePath };
          }),
      );
      const practices = decodedPractices.map(({ decodedPractice }) => decodedPractice);
      const practiceSourcePaths = new Map(
        decodedPractices.map(({ decodedPractice, relativePath }) => [
          decodedPractice.id,
          relativePath,
        ]),
      );

      return {
        input: { pack, practices, decisions: [] },
        files: [],
        practiceSourcePaths,
      };
    },
  };
}

async function withStore(
  operation: (store: LocalStore, rootPath: string) => Promise<void>,
): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-local-store-"));
  const store = await LocalStore.open({
    root: storageRoot(rootPath),
    snapshotCodec: testSnapshotCodec(),
  });
  try {
    await operation(store, rootPath);
  } finally {
    store.close();
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe("LocalStore lifecycle", () => {
  test("uses the user-level default root and accepts an injected StorageRoot", async () => {
    expect(defaultStorageRoot().path).toBe(join(homedir(), ".lorelum"));

    await withStore(async (store, rootPath) => {
      expect(store.root).toEqual(storageRoot(rootPath));
    });
  });

  test("installs immutable artifacts and reads persisted state after restart", async () => {
    await withStore(async (store, rootPath) => {
      const input = preparedPack("react-fullstack", "1.0.0", [
        practice("react.api.layered-design"),
      ]);
      const installed = await store.install(input);

      expect(installed.kind).toBe("installed");
      expect(installed.effectiveRevision).toBe(1);
      expect(store.effectivePractice("react.api.layered-design")?.sourcePackNames).toEqual([
        "react-fullstack",
      ]);

      const manifest = JSON.parse(
        await readFile(join(rootPath, "installed-packs.json"), "utf8"),
      ) as { packs: { storageKey: string; artifactDigest: string }[] };
      const entry = manifest.packs[0];
      expect(entry).toBeDefined();
      if (entry === undefined) throw new Error("expected installed pack manifest entry");
      await stat(join(rootPath, "store.sqlite"));
      await stat(join(rootPath, "packs", entry.storageKey, entry.artifactDigest, "pack.yaml"));

      store.close();
      const restarted = await LocalStore.open({
        root: storageRoot(rootPath),
        snapshotCodec: testSnapshotCodec(),
      });
      try {
        expect(restarted.state()).toEqual({ installedPacksGeneration: 1, effectiveRevision: 1 });
        expect(restarted.effectivePractices()).toHaveLength(1);
      } finally {
        restarted.close();
      }
    });
  });

  test("treats an identical install as idempotent and requires upgrade for changed artifacts", async () => {
    await withStore(async (store) => {
      const initial = preparedPack("react-fullstack", "1.0.0", [
        practice("react.api.layered-design"),
      ]);
      await store.install(initial);

      const unchanged = await store.install(initial);
      expect(unchanged.kind).toBe("unchanged");
      expect(unchanged.effectiveRevision).toBe(1);

      await expect(
        store.install(
          preparedPack("react-fullstack", "1.1.0", [practice("react.api.layered-design")]),
        ),
      ).rejects.toBeInstanceOf(PackUpgradeRequiredError);
    });
  });

  test("upgrade replaces all sources from the old Pack version", async () => {
    await withStore(async (store) => {
      await store.install(
        preparedPack("react-fullstack", "1.0.0", [
          practice("react.api.layered-design"),
          practice("react.state.redux"),
        ]),
      );

      const upgraded = await store.upgrade(
        preparedPack("react-fullstack", "1.1.0", [practice("react.api.layered-design")]),
      );
      expect(upgraded.kind).toBe("upgraded");
      expect(upgraded.effectiveRevision).toBe(2);
      expect(store.effectivePractice("react.state.redux")).toBeNull();
      expect(store.installedPacks()[0]?.version).toBe("1.1.0");
    });
  });

  test("increments effectiveRevision when an upgrade replaces effective content", async () => {
    await withStore(async (store) => {
      await store.install(
        preparedPack("react-fullstack", "1.0.0", [practice("react.api.layered-design")]),
      );

      const upgraded = await store.upgrade(
        preparedPack("react-fullstack", "1.1.0", [
          practice("react.api.layered-design", { body: "Updated guidance." }),
        ]),
      );

      expect(upgraded.effectiveRevision).toBe(2);
      expect(store.effectivePractice("react.api.layered-design")?.body).toBe("Updated guidance.");
      expect(store.effectivePractice("react.api.layered-design")?.effectiveRevision).toBe(2);
    });
  });

  test("merges matching Practice sources without changing effectiveRevision", async () => {
    await withStore(async (store) => {
      const shared = practice("react.api.layered-design");
      await store.install(preparedPack("react-base", "1.0.0", [shared]));
      const second = await store.install(preparedPack("react-team", "1.0.0", [shared]));

      expect(second.effectiveRevision).toBe(1);
      expect(store.effectivePractice(shared.id)?.sourcePackNames).toEqual([
        "react-base",
        "react-team",
      ]);

      const firstUninstall = await store.uninstall("react-base");
      expect(firstUninstall.effectiveRevision).toBe(1);
      expect(store.effectivePractice(shared.id)?.sourcePackNames).toEqual(["react-team"]);

      const finalUninstall = await store.uninstall("react-team");
      expect(finalUninstall.effectiveRevision).toBe(2);
      expect(store.effectivePractice(shared.id)).toBeNull();
    });
  });

  test("removes an unreferenced artifact after uninstall", async () => {
    await withStore(async (store, rootPath) => {
      const installed = await store.install(
        preparedPack("react-base", "1.0.0", [practice("react.api.layered-design")]),
      );
      const artifact = join(
        rootPath,
        "packs",
        installed.pack.storageKey,
        installed.pack.artifactDigest,
      );

      await store.uninstall("react-base");
      await expect(stat(artifact)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  test("rejects same-id Practices with different canonical content", async () => {
    await withStore(async (store) => {
      await store.install(
        preparedPack("react-base", "1.0.0", [practice("react.api.layered-design")]),
      );

      await expect(
        store.install(
          preparedPack("react-team", "1.0.0", [
            practice("react.api.layered-design", { body: "Different guidance." }),
          ]),
        ),
      ).rejects.toBeInstanceOf(PracticeConflictError);
    });
  });

  test("rejects an upgrade that conflicts with another active source", async () => {
    await withStore(async (store) => {
      const shared = practice("react.api.layered-design");
      await store.install(preparedPack("react-base", "1.0.0", [shared]));
      await store.install(preparedPack("react-team", "1.0.0", [shared]));

      await expect(
        store.upgrade(
          preparedPack("react-base", "1.1.0", [
            practice("react.api.layered-design", { body: "Different guidance." }),
          ]),
        ),
      ).rejects.toBeInstanceOf(PracticeConflictError);

      expect(store.installedPacks().find((pack) => pack.name === "react-base")?.version).toBe(
        "1.0.0",
      );
    });
  });

  test("keeps same-title Practices with different ids as independent effective records", async () => {
    await withStore(async (store) => {
      const title = "Use an API layer";
      await store.install(
        preparedPack("react-base", "1.0.0", [
          practice("react.api.base", { title }),
          practice("react.api.team", { title }),
        ]),
      );

      expect(store.effectivePractices().map((item) => item.id)).toEqual([
        "react.api.base",
        "react.api.team",
      ]);
    });
  });

  test("rejects invalid Pack input before any Pack becomes active", async () => {
    await withStore(async (store) => {
      const invalid = preparedPack("react-base", "1.0.0", [
        practice("react.api.layered-design", { id: "not-dotted" }),
      ]);

      await expect(store.install(invalid)).rejects.toBeInstanceOf(PackValidationError);
      expect(store.installedPacks()).toEqual([]);
      expect(store.effectivePractices()).toEqual([]);
    });
  });

  test("retains validation warnings without blocking installation", async () => {
    await withStore(async (store) => {
      const warned = preparedPack("react-base", "1.0.0", [
        practice("react.api.layered-design", { severity: undefined }),
      ]);
      const installed = await store.install(warned);

      expect(installed.validation.warnings.map((warning) => warning.code)).toContain(
        "missing-severity",
      );
      expect(store.effectivePractice("react.api.layered-design")?.severity).toBe("warn");
    });
  });

  test("rejects unsafe or missing Practice source paths", async () => {
    await withStore(async (store) => {
      const valid = preparedPack("react-base", "1.0.0", [practice("react.api.layered-design")]);
      const invalid: PreparedPack = {
        ...valid,
        practiceSourcePaths: new Map([["react.api.layered-design", "../outside.md"]]),
      };

      await expect(store.install(invalid)).rejects.toBeInstanceOf(InvalidPreparedPackError);
    });
  });

  test("rejects a snapshot whose decoded Pack or Practice differs from validated input", async () => {
    await withStore(async (store) => {
      const expected = preparedPack("react-base", "1.0.0", [practice("react.api.layered-design")]);
      const mismatched: PreparedPack = {
        ...expected,
        files: [
          {
            relativePath: "pack.yaml",
            bytes: new TextEncoder().encode(
              JSON.stringify({ name: "different-pack", version: "9.9.9" }),
            ),
          },
          {
            relativePath: "practices/react.api.layered-design.md",
            bytes: practiceMarkdown(
              practice("react.api.layered-design", { body: "Different guidance." }),
            ),
          },
        ],
      };

      await expect(store.install(mismatched)).rejects.toBeInstanceOf(InvalidPreparedPackError);
      expect(store.installedPacks()).toEqual([]);
      expect(store.effectivePractices()).toEqual([]);
    });
  });

  test("serializes concurrent mutations from multiple LocalStore instances", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "lorelum-local-store-"));
    const root = storageRoot(rootPath);
    const first = await LocalStore.open({ root, snapshotCodec: testSnapshotCodec() });
    const second = await LocalStore.open({ root, snapshotCodec: testSnapshotCodec() });

    try {
      const base = preparedPack("react-base", "1.0.0", [practice("react.api.base")]);
      const baseUpgrade = preparedPack("react-base", "1.1.0", [
        practice("react.api.base", { body: "Updated base guidance." }),
      ]);
      const team = preparedPack("react-team", "1.0.0", [practice("react.api.team")]);

      await first.install(base);
      await Promise.all([first.upgrade(baseUpgrade), second.install(team)]);
      await Promise.all([first.uninstall("react-base"), second.uninstall("react-team")]);

      const manifest = JSON.parse(
        await readFile(join(rootPath, "installed-packs.json"), "utf8"),
      ) as { schemaVersion: number; generation: number; packs: { name: string }[] };
      expect(manifest).toEqual({ generation: 5, packs: [], schemaVersion: 1 });

      const restarted = await LocalStore.open({ root, snapshotCodec: testSnapshotCodec() });
      try {
        expect(restarted.installedPacks()).toEqual([]);
        expect(restarted.effectivePractices()).toEqual([]);
        expect(restarted.state()).toEqual({ installedPacksGeneration: 5, effectiveRevision: 5 });
      } finally {
        restarted.close();
      }
    } finally {
      first.close();
      second.close();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
