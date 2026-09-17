import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";
import { RegistrySchema, type RegistryRelease } from "@lorelum/format";
import type { IndexOperation } from "@lorelum/backend/protocol";

import { run as runCli } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { snapshotCommandDefinitions } from "../registry.js";
import {
  createInstallCommand,
  createUpdateCommand,
  type InstallCommandServices,
} from "./install-command.js";
import { resolveRegistryRepository } from "./load-registry.js";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

function registry(version = "0.1.0") {
  return RegistrySchema.parse({
    schema_version: 1,
    name: "team-packs",
    packs: [
      {
        name: "agentic-coding",
        releases: [
          {
            version,
            ref: `agentic-coding-v${version}`,
            path: "packs/agentic-coding",
          },
        ],
      },
    ],
  });
}

async function createPack(directory: string): Promise<string> {
  const packDirectory = join(directory, "pack");
  await mkdir(join(packDirectory, "practices"), { recursive: true });
  await writeFile(
    join(packDirectory, "pack.yaml"),
    "name: agentic-coding\nversion: 0.1.0\ndescription: Installation placeholder.\n",
  );
  await writeFile(
    join(packDirectory, "practices", "placeholder.md"),
    `---
id: agentic-coding.installation.placeholder
title: Installation placeholder
stage: installation
tech_stack: [agentic-coding]
applies_when: validating the Knowledge Pack installation pipeline
severity: info
---
This placeholder proves the Pack can be decoded and installed.
`,
  );
  return packDirectory;
}

function createServices(
  packDirectory: string,
  storageRoot: string,
  registryVersion = "0.1.0",
  indexBuild?: (rootPath: string) => Promise<IndexOperation>,
): {
  services: InstallCommandServices;
  store: ReturnType<typeof createLocalStore>;
  observed: {
    cleaned: number;
    locator: string | undefined;
    repository: string | undefined;
    syncedRoots: string[];
  };
} {
  const observed = { cleaned: 0, locator: undefined, repository: undefined, syncedRoots: [] } as {
    cleaned: number;
    locator: string | undefined;
    repository: string | undefined;
    syncedRoots: string[];
  };
  const store = createLocalStore();
  return {
    observed,
    store,
    services: {
      async loadRegistry(locator) {
        observed.locator = locator;
        return {
          registry: registry(registryVersion),
          repository: resolveRegistryRepository(locator),
        };
      },
      async materializeRelease(release: RegistryRelease, repository: string) {
        observed.repository = repository;
        return {
          directory: packDirectory,
          resolvedRef: release.ref,
          resolvedCommit: "0123456789abcdef0123456789abcdef01234567",
          async cleanup() {
            observed.cleaned += 1;
          },
        };
      },
      decodePackDirectory,
      async createIndexRuntimeClient() {
        return {
          async build(root) {
            observed.syncedRoots.push(root.rootPath);
            if (indexBuild) return indexBuild(root.rootPath);
            return {
              operationId: crypto.randomUUID(),
              state: "ready" as const,
              index: { state: "ready" as const, profileId: "a".repeat(64), vectorCount: 1 },
            };
          },
          async rebuild() {
            throw new Error("install must use incremental build");
          },
        };
      },
      progressWriter: { write: () => undefined },
      store,
      storageRoot: { rootPath: storageRoot },
    },
  };
}

test("installs from an explicit Registry repository and is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const storageRoot = join(directory, "store");
    const fixture = createServices(await createPack(directory), storageRoot);
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    const firstOutput = new MemoryWriter();

    expect(
      await run(["pack", "install", "agentic-coding@0.1.0", "--registry", "acme/team-packs"], {
        registry: definitions,
        stdout: firstOutput,
      }),
    ).toBe(0);
    const first = JSON.parse(firstOutput.value);
    expect(first).toMatchObject({
      ok: true,
      command: "pack.install",
      data: {
        registry: { name: "team-packs", repository: "acme/team-packs" },
        pack: { name: "agentic-coding", version: "0.1.0" },
        idempotent: false,
        generation: 1,
        effectiveRevision: 1,
        delta: { added: ["agentic-coding.installation.placeholder"] },
        packRoot: join(storageRoot, "packs", "p-agentic-coding", "current"),
        indexSync: { state: "ready", index: { state: "ready", vectorCount: 1 } },
      },
    });
    expect(first.data.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.observed.locator).toBe("acme/team-packs");
    expect(fixture.observed.repository).toBe("https://github.com/acme/team-packs.git");
    expect(fixture.observed.syncedRoots).toEqual([storageRoot]);
    const installDefinition = definitions.find((definition) => definition.name === "pack.install")!;
    expect(validateJsonSchema(first.data, installDefinition.resultSchema)).toEqual([]);

    const secondOutput = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding", "--registry", "acme/team-packs"], {
        registry: definitions,
        stdout: secondOutput,
      }),
    ).toBe(0);
    expect(JSON.parse(secondOutput.value)).toMatchObject({
      data: {
        idempotent: true,
        generation: 1,
        effectiveRevision: 1,
        artifactDigest: first.data.artifactDigest,
        packRoot: first.data.packRoot,
        delta: { added: [], changed: [], invalidated: [] },
        indexSync: { state: "ready" },
      },
    });
    expect(fixture.observed.syncedRoots).toEqual([storageRoot, storageRoot]);
    expect(fixture.observed.cleaned).toBe(2);
    expect(await fixture.store.readEffectivePractices({ rootPath: storageRoot })).toHaveLength(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("uses an explicit global Store root without touching the default Store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const defaultRoot = join(directory, "default-store");
    const isolatedRoot = join(directory, "worktree-store");
    const fixture = createServices(await createPack(directory), defaultRoot);
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    const firstOutput = new MemoryWriter();

    expect(
      await run(["--store-root", isolatedRoot, "pack", "install", "agentic-coding"], {
        registry: definitions,
        stdout: firstOutput,
      }),
    ).toBe(0);
    expect(JSON.parse(firstOutput.value)).toMatchObject({ data: { idempotent: false } });
    expect(existsSync(defaultRoot)).toBe(false);
    expect(await fixture.store.readEffectivePractices({ rootPath: isolatedRoot })).toHaveLength(1);

    const secondOutput = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding", "--store-root", isolatedRoot], {
        registry: definitions,
        stdout: secondOutput,
      }),
    ).toBe(0);
    expect(JSON.parse(secondOutput.value)).toMatchObject({ data: { idempotent: true } });
    expect(existsSync(defaultRoot)).toBe(false);
    expect(fixture.observed.syncedRoots).toEqual([isolatedRoot, isolatedRoot]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a changed installed Pack requires an explicit update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const packDirectory = await createPack(directory);
    const storageRoot = join(directory, "store");
    const first = createServices(packDirectory, storageRoot);
    const firstDefinitions = snapshotCommandDefinitions([createInstallCommand(first.services)]);
    expect(
      await run(["pack", "install", "agentic-coding"], {
        registry: firstDefinitions,
        stdout: new MemoryWriter(),
      }),
    ).toBe(0);

    await writeFile(
      join(packDirectory, "practices", "placeholder.md"),
      `---
id: agentic-coding.installation.placeholder
title: Installation placeholder
stage: installation
tech_stack: [agentic-coding]
applies_when: validating the Knowledge Pack installation pipeline
severity: info
---
Changed content that must not be installed implicitly.
`,
    );
    const changed = createServices(packDirectory, storageRoot);
    const definitions = snapshotCommandDefinitions([createInstallCommand(changed.services)]);
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding"], { registry: definitions, stdout }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      ok: false,
      error: {
        code: "pack.update-required",
        message: "The selected Pack has changed; use `lore pack update` to replace it.",
      },
    });
    const effective = await first.store.readEffectivePractices({ rootPath: storageRoot });
    expect(effective[0]?.practice.body).toContain("can be decoded and installed");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("updates an installed Pack from the selected Registry release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const packDirectory = await createPack(directory);
    const storageRoot = join(directory, "store");
    const installed = createServices(packDirectory, storageRoot);
    expect(
      await run(["pack", "install", "agentic-coding"], {
        registry: snapshotCommandDefinitions([createInstallCommand(installed.services)]),
        stdout: new MemoryWriter(),
      }),
    ).toBe(0);

    await writeFile(
      join(packDirectory, "pack.yaml"),
      "name: agentic-coding\nversion: 0.2.0\ndescription: Upgraded placeholder.\n",
    );
    await writeFile(
      join(packDirectory, "practices", "placeholder.md"),
      `---
id: agentic-coding.installation.placeholder
title: Installation placeholder
stage: installation
tech_stack: [agentic-coding]
applies_when: validating the Knowledge Pack installation pipeline
severity: info
---
This placeholder proves the Pack can be upgraded.
`,
    );

    const upgraded = createServices(packDirectory, storageRoot, "0.2.0");
    const definitions = snapshotCommandDefinitions([createUpdateCommand(upgraded.services)]);
    const stdout = new MemoryWriter();
    expect(
      await run(["--store-root", storageRoot, "pack", "update", "agentic-coding@0.2.0"], {
        registry: definitions,
        stdout,
      }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({
      command: "pack.update",
      ok: true,
      data: {
        pack: { name: "agentic-coding", version: "0.2.0" },
        idempotent: false,
        generation: 2,
        effectiveRevision: 2,
        packRoot: join(storageRoot, "packs", "p-agentic-coding", "current"),
        delta: { changed: ["agentic-coding.installation.placeholder"] },
      },
    });
    expect(validateJsonSchema(response.data, definitions[0]!.resultSchema)).toEqual([]);
    expect(upgraded.observed.cleaned).toBe(1);
    expect(upgraded.observed.syncedRoots).toEqual([]);
    expect(
      (await upgraded.store.readEffectivePractices({ rootPath: storageRoot }))[0]?.practice.body,
    ).toContain("can be upgraded");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("reports a typed error when updating a Pack that is not installed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const fixture = createServices(await createPack(directory), join(directory, "store"));
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "update", "agentic-coding"], {
        registry: snapshotCommandDefinitions([createUpdateCommand(fixture.services)]),
        stdout,
      }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "pack.update",
      ok: false,
      error: { code: "pack.not-installed" },
    });
    expect(fixture.observed.cleaned).toBe(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects a release whose Pack identity does not match the Registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const fixture = createServices(await createPack(directory), join(directory, "store"), "0.2.0");
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding"], { registry: definitions, stdout }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      ok: false,
      error: { code: "pack.invalid" },
    });
    expect(fixture.observed.cleaned).toBe(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("reports a failed index sync without rolling back the committed Pack", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const storageRoot = join(directory, "store");
    const fixture = createServices(await createPack(directory), storageRoot, "0.1.0", async () => ({
      operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      state: "failed",
      error: "embedding.download-failed",
    }));
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding"], { registry: definitions, stdout }),
    ).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      ok: true,
      data: {
        idempotent: false,
        indexSync: {
          state: "failed",
          error: {
            code: "embedding.download-failed",
            message: expect.stringContaining("Pack installed, but semantic index sync failed."),
          },
        },
      },
    });
    expect(fixture.observed.syncedRoots).toEqual([storageRoot]);
    expect(await fixture.store.readEffectivePractices({ rootPath: storageRoot })).toHaveLength(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test.each([
  {
    operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    state: "building" as const,
  },
  {
    operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    state: "preparing" as const,
    preparationId: "1f8fad5b-d9cb-469f-a165-70867728950e",
  },
])("reports accepted index work as pending without changing Pack success", async (operation) => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const storageRoot = join(directory, "store");
    const fixture = createServices(
      await createPack(directory),
      storageRoot,
      "0.1.0",
      async () => operation,
    );
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding"], { registry: definitions, stdout }),
    ).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      ok: true,
      data: { indexSync: { state: "pending", operationId: operation.operationId } },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("hands the SSH git URL to materialization and keeps credentials out of output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const storageRoot = join(directory, "store");
    const fixture = createServices(await createPack(directory), storageRoot);
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    const stdout = new MemoryWriter();

    expect(
      await run(
        ["pack", "install", "agentic-coding", "--registry", "git@github.com:acme/team-packs.git"],
        { registry: definitions, stdout },
      ),
    ).toBe(0);
    const parsed = JSON.parse(stdout.value);
    expect(parsed).toMatchObject({
      ok: true,
      data: { registry: { name: "team-packs", repository: "acme/team-packs" }, idempotent: false },
    });
    expect(fixture.observed.locator).toBe("git@github.com:acme/team-packs.git");
    expect(fixture.observed.repository).toBe("git@github.com:acme/team-packs.git");
    expect(stdout.value).not.toMatch(/\/\/[^/\s]*:[^@\s]*@/);
    expect(stdout.value).not.toMatch(/token/i);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
