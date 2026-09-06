import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";

import { run } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { snapshotCommandDefinitions } from "../registry.js";
import { createGetCommand } from "./get-command.js";

const id = "example.read-practice";

async function withDirectory(action: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-get-"));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function install(
  directory: string,
  packName = "sample",
  rootName = "store",
  body = "Complete guidance.\n",
) {
  const packPath = join(directory, packName);
  await mkdir(join(packPath, "practices"), { recursive: true });
  await writeFile(join(packPath, "pack.yaml"), `name: ${packName}\nversion: 1.0.0\n`);
  await writeFile(
    join(packPath, "practices/read.md"),
    `---
id: ${id}
title: Read the requested Practice
stage: verification
tech_stack: [typescript, bun]
applies_when: when reading installed guidance
anti_patterns:
  - id: example.ignore-evidence
    name: Ignore evidence
    description: Guessing without checking.
  - id: example.invent-evidence
    name: Invent evidence
    description: Claiming an unobserved outcome.
    severity: critical
---
${body}`,
  );
  const decoded = await decodePackDirectory(packPath);
  const root = { rootPath: join(directory, rootName) };
  await createLocalStore().install(root, decoded.candidate, decoded.diagnostics);
  return root;
}

async function get(directory: string, rootName = "store", practiceId = id) {
  const unusedRoot = join(directory, "unused-default");
  const definition = createGetCommand({
    store: createLocalStore(),
    storageRoot: { rootPath: unusedRoot },
  });
  const stdout = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const stderr = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const exitCode = await run(["get", practiceId, "--store-root", join(directory, rootName)], {
    registry: snapshotCommandDefinitions([definition]),
    stdout,
    stderr,
  });
  expect(existsSync(unusedRoot)).toBe(false);
  expect(stderr.value).toBe("");
  expect(stdout.value.trim().split("\n")).toHaveLength(1);
  expect(stdout.value).not.toContain(directory);
  const response = JSON.parse(stdout.value);
  if (response.ok) expect(validateJsonSchema(response.data, definition.resultSchema)).toEqual([]);
  return { exitCode, response, output: stdout.value };
}

test("returns canonical defaults, author order and merged sources independent of install order", async () => {
  await withDirectory(async (directory) => {
    const root = await install(directory, "z-pack");
    await install(directory, "a-pack");
    await install(directory, "a-pack", "reverse");
    await install(directory, "z-pack", "reverse");
    const before = await createLocalStore().open(root);
    const manifest = await readFile(join(root.rootPath, "installed-packs.json"), "utf8");
    const result = await get(directory);
    expect(result.exitCode).toBe(0);
    expect(result.response.data.practice).toMatchObject({
      id,
      severity: "warn",
      body: "Complete guidance.\n",
      tech_stack: ["typescript", "bun"],
      anti_patterns: [
        { id: "example.ignore-evidence", severity: "warn" },
        { id: "example.invent-evidence", severity: "critical" },
      ],
    });
    expect(result.response.data.sources).toEqual([
      { packName: "a-pack", sourcePath: "practices/read.md" },
      { packName: "z-pack", sourcePath: "practices/read.md" },
    ]);
    expect(result.output).toBe((await get(directory, "reverse")).output);
    expect(result.output).toBe((await get(directory)).output);
    expect(result.response.data.contentDigest).toBe(before.effectivePractices[0]!.contentDigest);
    expect(await readFile(join(root.rootPath, "installed-packs.json"), "utf8")).toBe(manifest);
    const after = await createLocalStore().open(root);
    expect(after).toEqual(before);
  });
});

test("a missing Store initializes normally and reports absence", async () => {
  await withDirectory(async (directory) => {
    const result = await get(directory);
    expect(result.exitCode).toBe(2);
    expect(result.response.error.code).toBe("practice.not-found");
  });
});

test("Store overrides isolate content and empty guidance stays retrievable", async () => {
  await withDirectory(async (directory) => {
    await install(directory, "sample", "store", "");
    expect((await get(directory)).response.data.practice.body).toBe("");
    expect((await get(directory, "other-store")).response.error.code).toBe("practice.not-found");
  });
});

test.each(["artifact", "sqlite"] as const)(
  "fails on damaged %s even when the ID is absent",
  async (damage) => {
    await withDirectory(async (directory) => {
      const root = await install(directory);
      if (damage === "artifact") {
        const artifactRoot = join(root.rootPath, "packs/p-sample");
        const [digest] = await readdir(artifactRoot);
        expect(digest).toBeDefined();
        await writeFile(join(artifactRoot, digest!, "practices/read.md"), "Changed artifact.\n");
      } else {
        await rm(join(root.rootPath, "store.sqlite"));
      }
      for (const practiceId of [id, "example.absent"]) {
        // eslint-disable-next-line no-await-in-loop -- verify the same damaged Store for both lookups
        const result = await get(directory, "store", practiceId);
        expect(result.exitCode).toBe(2);
        expect(result.response.error.code).toBe("store.recovery-required");
      }
    });
  },
);

test("cold open converges an interrupted manifest publication before returning guidance", async () => {
  await withDirectory(async (directory) => {
    const root = await install(directory);
    const manifestPath = join(root.rootPath, "installed-packs.json");
    const oldManifest = await readFile(manifestPath, "utf8");
    const before = JSON.parse(oldManifest);
    const target = {
      ...before,
      generation: before.generation + 1,
      effectiveRevision: before.effectiveRevision + 1,
    };
    // Simulate the persisted crash window: target manifest published, SQLite still at old tuple.
    const operationId = "00000000-0000-4000-8000-000000000001";
    const operations = join(root.rootPath, "operations");
    await mkdir(operations, { recursive: true });
    await writeFile(
      join(operations, `${operationId}.json`),
      JSON.stringify({
        operationId,
        operationType: "reindex",
        createdAt: "2026-01-01T00:00:00.000Z",
        oldGeneration: before.generation,
        targetGeneration: target.generation,
        oldEffectiveRevision: before.effectiveRevision,
        targetEffectiveRevision: target.effectiveRevision,
        oldManifest,
        targetManifest: JSON.stringify(target),
      }),
    );
    await writeFile(manifestPath, JSON.stringify(target));
    const result = await get(directory);
    expect(result.exitCode).toBe(0);
    expect(result.response.data.practice.id).toBe(id);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual(before);
    expect(await readdir(operations)).toEqual([]);
  });
});
