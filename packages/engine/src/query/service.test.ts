import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory, type StorageRoot } from "../local-store/index.js";
import { InvalidQueryError } from "./errors.js";
import { createQueryService } from "./service.js";

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

async function writeLocalQueryPack(directory: string): Promise<string> {
  const packRoot = join(directory, "local-query-pack");
  const practices = join(packRoot, "practices", "react");
  await mkdir(practices, { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), "name: local-query-fixture\nversion: 0.1.0\n");
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

test("QueryService reads a simple installed Pack through LocalStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-query-service-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const packRoot = await writeLocalQueryPack(directory);
    const decoded = await decodePackDirectory(packRoot);
    const store = createLocalStore();
    await store.install(storageRoot, decoded.candidate, decoded.diagnostics);
    const service = createQueryService({ store, storageRoot });

    const result = await service.query({ query: "remote requests interface" });
    expect(result).toMatchObject({
      query: "remote requests interface",
      k: 5,
      total: 2,
      generation: 1,
      effectiveRevision: 1,
    });
    expect(result.results[0]).toEqual({
      id: "react.api-client",
      title: "Layer React API access",
      stage: "api-layer",
      tech_stack: ["react", "typescript"],
      applies_when: "adding remote requests to a React interface",
    });
  } finally {
    await removeStoreRoot(directory);
  }
});

test("QueryService honors a per-call storageRoot override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-query-override-"));
  const defaultRoot: StorageRoot = { rootPath: join(directory, "default-store") };
  const overrideRoot: StorageRoot = { rootPath: join(directory, "override-store") };
  try {
    const packRoot = await writeLocalQueryPack(directory);
    const decoded = await decodePackDirectory(packRoot);
    const store = createLocalStore();
    await store.install(overrideRoot, decoded.candidate, decoded.diagnostics);
    const service = createQueryService({ store, storageRoot: defaultRoot });

    const overridden = await service.query({ query: "remote requests", storageRoot: overrideRoot });
    expect(overridden).toMatchObject({ generation: 1, total: 2 });

    const fallback = await service.query({ query: "remote requests" });
    expect(fallback).toMatchObject({ generation: 0, total: 0, results: [] });
  } finally {
    await removeStoreRoot(directory);
  }
});
test("QueryService succeeds with an empty fresh LocalStore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-query-empty-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const result = await createQueryService({ storageRoot }).query({ query: "axios component" });
    expect(result).toMatchObject({
      generation: 0,
      effectiveRevision: 0,
      total: 0,
      results: [],
    });
  } finally {
    await removeStoreRoot(directory);
  }
});

test("QueryService rejects blank query text with a typed error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-query-blank-"));
  const storageRoot: StorageRoot = { rootPath: join(directory, "store") };
  try {
    const service = createQueryService({ storageRoot });
    expect(service.query({ query: "   " })).rejects.toThrow(InvalidQueryError);
  } finally {
    await removeStoreRoot(directory);
  }
});
