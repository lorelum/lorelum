import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalStore,
  decodePackDirectory,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type LocalStore,
  type OpenResult,
  type StorageRoot,
} from "../local-store/index.js";
import { UnknownPackError } from "./errors.js";
import { createListService } from "./service.js";

async function removeStoreRoot(rootPath: string): Promise<void> {
  /* eslint-disable no-await-in-loop -- Windows may release SQLite handles asynchronously. */
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(rootPath, { force: true, recursive: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await Bun.sleep(50);
    }
  }
  /* eslint-enable no-await-in-loop */
}

async function writeLocalListPack(directory: string): Promise<string> {
  const packRoot = join(directory, "local-list-pack");
  const practices = join(packRoot, "practices", "react");
  await mkdir(practices, { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), "name: local-list-fixture\nversion: 0.1.0\n");
  await writeFile(
    join(practices, "z-api.md"),
    [
      "---",
      "id: react.z-api",
      "title: Layer React API access",
      "stage: api-layer",
      "tech_stack: [react, typescript]",
      "applies_when: adding remote requests to a React interface",
      "severity: warn",
      "---",
      "Keep transport, DTO translation, and expected failures behind a feature API boundary.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(practices, "a-state.md"),
    [
      "---",
      "id: react.a-state",
      "title: Separate resource and UI state",
      "stage: state",
      "tech_stack: [react, typescript]",
      "applies_when: storing remote resource data used by a React interface",
      "severity: warn",
      "---",
      "Model resource data separately from view state and transform DTOs at the boundary.",
      "",
    ].join("\n"),
  );
  return packRoot;
}

function fakeStore(open: OpenResult): Pick<LocalStore, "open"> {
  return {
    open: async () => open,
  };
}

test("ListService reads the Pack catalog and a selected Pack through LocalStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-list-service-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const packRoot = await writeLocalListPack(directory);
    const decoded = await decodePackDirectory(packRoot);
    const store = createLocalStore();
    await store.install(storageRoot, decoded.candidate, decoded.diagnostics);
    const service = createListService({ store, storageRoot });

    const packsResult = await service.list();
    expect(packsResult).toEqual({
      generation: 1,
      effectiveRevision: 1,
      packs: [{ name: "local-list-fixture", version: "0.1.0", practiceCount: 2 }],
    });
    expect(Object.isFrozen(packsResult)).toBe(true);
    expect(Object.isFrozen(packsResult.packs)).toBe(true);

    const practicesResult = await service.listPack({ packName: "local-list-fixture" });
    expect(practicesResult).toEqual({
      generation: 1,
      effectiveRevision: 1,
      pack: { name: "local-list-fixture", version: "0.1.0" },
      practices: [
        {
          id: "react.a-state",
          title: "Separate resource and UI state",
          applies_when: "storing remote resource data used by a React interface",
        },
        {
          id: "react.z-api",
          title: "Layer React API access",
          applies_when: "adding remote requests to a React interface",
        },
      ],
    });
    expect(Object.isFrozen(practicesResult)).toBe(true);
    expect(Object.isFrozen(practicesResult.pack)).toBe(true);
    expect(Object.isFrozen(practicesResult.practices)).toBe(true);
    expect(Object.isFrozen(practicesResult.practices[0])).toBe(true);
  } finally {
    await removeStoreRoot(directory);
  }
});

test("ListService honors a per-call storageRoot override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-list-override-"));
  const defaultRoot: StorageRoot = { rootPath: join(directory, "default-store") };
  const overrideRoot: StorageRoot = { rootPath: join(directory, "override-store") };
  try {
    const packRoot = await writeLocalListPack(directory);
    const decoded = await decodePackDirectory(packRoot);
    const store = createLocalStore();
    await store.install(overrideRoot, decoded.candidate, decoded.diagnostics);
    const service = createListService({ store, storageRoot: defaultRoot });

    await expect(service.list({ storageRoot: overrideRoot })).resolves.toMatchObject({
      generation: 1,
      packs: [{ name: "local-list-fixture", practiceCount: 2 }],
    });
    await expect(service.list()).resolves.toMatchObject({
      generation: 0,
      packs: [],
    });
  } finally {
    await removeStoreRoot(directory);
  }
});

test("ListService succeeds with an empty fresh LocalStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-list-empty-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    await expect(createListService({ storageRoot }).list()).resolves.toEqual({
      generation: 0,
      effectiveRevision: 0,
      packs: [],
    });
  } finally {
    await removeStoreRoot(directory);
  }
});

test("ListService maps missing and blank Pack names to UnknownPackError", async () => {
  const service = createListService({
    store: fakeStore({
      generation: 1,
      effectiveRevision: 2,
      packs: [{ name: "platform", version: "1.0.0" }],
      effectivePractices: [],
    }),
  });

  await expect(service.listPack({ packName: "missing" })).rejects.toThrow(UnknownPackError);
  await expect(service.listPack({ packName: "   " })).rejects.toThrow(UnknownPackError);
});

test("ListService propagates LocalStore busy and recovery failures", async () => {
  /* eslint-disable no-await-in-loop -- each error case asserts both sequential call sites. */
  for (const error of [new StoreBusyError("busy"), new StoreRecoveryRequiredError("recovery")]) {
    const store: Pick<LocalStore, "open"> = {
      ...fakeStore({
        generation: 0,
        effectiveRevision: 0,
        packs: [],
        effectivePractices: [],
      }),
      open: async () => {
        throw error;
      },
    };
    await expect(createListService({ store }).list()).rejects.toBe(error);
    await expect(createListService({ store }).listPack({ packName: "platform" })).rejects.toBe(
      error,
    );
  }
  /* eslint-enable no-await-in-loop */
});
