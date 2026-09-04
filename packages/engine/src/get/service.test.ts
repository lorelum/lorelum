import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory, type StorageRoot } from "../local-store/index.js";
import { UnknownPracticeError } from "./errors.js";
import { createGetService } from "./service.js";

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

async function writeLocalGetPack(directory: string): Promise<string> {
  const packRoot = join(directory, "local-get-pack");
  const practices = join(packRoot, "practices", "react");
  await mkdir(practices, { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), "name: local-get-fixture\nversion: 0.1.0\n");
  await writeFile(
    join(practices, "api-client.md"),
    [
      "---",
      "id: react.api-client",
      "title: Layer React API access",
      "stage: api-layer",
      "tech_stack: [react, typescript]",
      "applies_when: adding remote requests to a React interface",
      "severity: warn",
      "anti_patterns:",
      "  - id: react.direct-http-in-component",
      "    name: Direct HTTP client in component",
      "    description: Calling axios or fetch directly from a component couples UI to transport.",
      "    severity: critical",
      "---",
      "Keep transport, DTO translation, and expected failures behind a feature API boundary.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(practices, "resource-state.md"),
    [
      "---",
      "id: react.resource-state",
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

test("GetService reads a simple installed Pack through LocalStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-get-service-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const packRoot = await writeLocalGetPack(directory);
    const decoded = await decodePackDirectory(packRoot);
    const store = createLocalStore();
    await store.install(storageRoot, decoded.candidate, decoded.diagnostics);
    const service = createGetService({ store, storageRoot });

    const result = await service.get({ practiceId: "react.api-client" });
    expect(result).toMatchObject({
      generation: 1,
      effectiveRevision: 1,
      sources: [
        {
          pack: "local-get-fixture",
          sourcePath: "practices/react/api-client.md",
        },
      ],
    });
    expect(result.practice).toMatchObject({
      id: "react.api-client",
      title: "Layer React API access",
      stage: "api-layer",
      tech_stack: ["react", "typescript"],
      applies_when: "adding remote requests to a React interface",
      severity: "warn",
      body: "Keep transport, DTO translation, and expected failures behind a feature API boundary.\n",
    });
    expect(result.practice.anti_patterns).toEqual([
      {
        id: "react.direct-http-in-component",
        name: "Direct HTTP client in component",
        description: "Calling axios or fetch directly from a component couples UI to transport.",
        severity: "critical",
      },
    ]);
  } finally {
    await removeStoreRoot(directory);
  }
});

test("GetService honors a per-call storageRoot override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-get-override-"));
  const defaultRoot: StorageRoot = { rootPath: join(directory, "default-store") };
  const overrideRoot: StorageRoot = { rootPath: join(directory, "override-store") };
  try {
    const packRoot = await writeLocalGetPack(directory);
    const decoded = await decodePackDirectory(packRoot);
    const store = createLocalStore();
    await store.install(overrideRoot, decoded.candidate, decoded.diagnostics);
    const service = createGetService({ store, storageRoot: defaultRoot });

    const overridden = await service.get({
      practiceId: "react.api-client",
      storageRoot: overrideRoot,
    });
    expect(overridden).toMatchObject({
      generation: 1,
      effectiveRevision: 1,
      practice: { id: "react.api-client" },
    });

    await expect(service.get({ practiceId: "react.api-client" })).rejects.toThrow(
      UnknownPracticeError,
    );
  } finally {
    await removeStoreRoot(directory);
  }
});

test("GetService succeeds with an empty fresh LocalStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-get-empty-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const service = createGetService({ storageRoot });
    await expect(service.get({ practiceId: "react.api-client" })).rejects.toThrow(
      UnknownPracticeError,
    );
  } finally {
    await removeStoreRoot(directory);
  }
});

test("GetService maps a blank id to UnknownPracticeError before store access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-get-blank-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const service = createGetService({ storageRoot });
    await expect(service.get({ practiceId: "   " })).rejects.toThrow(UnknownPracticeError);
  } finally {
    await removeStoreRoot(directory);
  }
});
