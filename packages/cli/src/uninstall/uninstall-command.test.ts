import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";

import { run as runCli } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { snapshotCommandDefinitions } from "../registry.js";
import { createRemoveCommand } from "./uninstall-command.js";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

async function createPack(directory: string): Promise<string> {
  const packDirectory = join(directory, "pack");
  await mkdir(join(packDirectory, "practices"), { recursive: true });
  await writeFile(
    join(packDirectory, "pack.yaml"),
    "name: agentic-coding\nversion: 0.1.0\ndescription: Removal placeholder.\n",
  );
  await writeFile(
    join(packDirectory, "practices", "placeholder.md"),
    `---
id: agentic-coding.installation.placeholder
title: Installation placeholder
stage: installation
tech_stack: [agentic-coding]
applies_when: validating the Knowledge Pack removal pipeline
severity: info
---
This placeholder proves the Pack can be removed.
`,
  );
  return packDirectory;
}

test("removes a Pack from an explicit Store root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-uninstall-command-"));
  try {
    const defaultRoot = join(directory, "default-store");
    const selectedRoot = join(directory, "selected-store");
    const store = createLocalStore();
    const decoded = await decodePackDirectory(await createPack(directory));
    await store.install({ rootPath: selectedRoot }, decoded.candidate, decoded.diagnostics);
    const definitions = snapshotCommandDefinitions([
      createRemoveCommand({ store, storageRoot: { rootPath: defaultRoot } }),
    ]);
    const stdout = new MemoryWriter();

    expect(
      await run(["--store-root", selectedRoot, "pack", "remove", "agentic-coding"], {
        registry: definitions,
        stdout,
      }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({
      command: "pack.remove",
      ok: true,
      data: {
        pack: { name: "agentic-coding" },
        generation: 2,
        effectiveRevision: 2,
        delta: { invalidated: ["agentic-coding.installation.placeholder"] },
      },
    });
    expect(validateJsonSchema(response.data, definitions[0]!.resultSchema)).toEqual([]);
    expect(await store.readEffectivePractices({ rootPath: selectedRoot })).toEqual([]);
    expect(existsSync(defaultRoot)).toBe(false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("returns pack.not-installed without mutating the selected Store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-uninstall-command-"));
  try {
    const rootPath = join(directory, "store");
    const stdout = new MemoryWriter();
    const definitions = snapshotCommandDefinitions([
      createRemoveCommand({
        store: createLocalStore(),
        storageRoot: { rootPath },
      }),
    ]);

    expect(await run(["pack", "remove", "agentic-coding"], { registry: definitions, stdout })).toBe(
      2,
    );
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "pack.remove",
      ok: false,
      error: { code: "pack.not-installed" },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
