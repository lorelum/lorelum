import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalStore,
  decodePackDirectory,
  StoreBusyError,
  StoreRecoveryRequiredError,
} from "@lorelum/engine";
import { RegistrySchema, type RegistryRelease } from "@lorelum/format";
import type { IndexOperation } from "@lorelum/backend/protocol";

import { run as runCli } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { snapshotCommandDefinitions } from "../registry.js";
import { CliError, cliErrorCodes } from "../runtime/errors.js";
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
      async selectRegistry(selector) {
        return {
          kind: "remote" as const,
          ...(selector === undefined ? {} : { locator: selector }),
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

test("installs an explicit local Pack directory without entering the Registry route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
  try {
    const packDirectory = await createPack(directory);
    const defaultStorageRoot = join(directory, "default-store");
    const isolatedStorageRoot = join(directory, "isolated-store");
    const fixture = createServices(packDirectory, defaultStorageRoot);
    const services: InstallCommandServices = {
      ...fixture.services,
      async selectRegistry() {
        throw new Error("directory source must not select a Registry");
      },
      async loadRegistry() {
        throw new Error("directory source must not load a Registry");
      },
      async loadLocalRegistry() {
        throw new Error("directory source must not load a local Registry");
      },
      async materializeRelease() {
        throw new Error("directory source must not materialize a remote Registry release");
      },
      async materializeLocalRelease() {
        throw new Error("directory source must not materialize a local Registry release");
      },
    };
    const definitions = snapshotCommandDefinitions([createInstallCommand(services)]);
    const stdout = new MemoryWriter();

    expect(
      await run(["--store-root", isolatedStorageRoot, "pack", "install", "--path", packDirectory], {
        registry: definitions,
        stdout,
      }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({
      command: "pack.install",
      ok: true,
      data: {
        pack: { name: "agentic-coding", version: "0.1.0" },
        source: { type: "directory" },
        indexSync: { state: "ready" },
      },
    });
    expect(response.data.registry).toBeUndefined();
    expect(response.data.source.ref).toBeUndefined();
    expect(response.data.source.commit).toBeUndefined();
    expect(stdout.value).not.toContain(packDirectory);
    expect(fixture.observed.locator).toBeUndefined();
    expect(fixture.observed.repository).toBeUndefined();
    expect(fixture.observed.syncedRoots).toEqual([isolatedStorageRoot]);
    expect(existsSync(defaultStorageRoot)).toBe(false);
    expect(validateJsonSchema(response.data, definitions[0]!.resultSchema)).toEqual([]);

    const repeat = new MemoryWriter();
    expect(
      await run(["--store-root", isolatedStorageRoot, "pack", "install", "--path", packDirectory], {
        registry: definitions,
        stdout: repeat,
      }),
    ).toBe(0);
    expect(JSON.parse(repeat.value)).toMatchObject({
      data: { idempotent: true, source: { type: "directory" } },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("requires an explicit local update and does not start index sync for it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
  try {
    const packDirectory = await createPack(directory);
    const storageRoot = join(directory, "store");
    const installed = createServices(packDirectory, storageRoot);
    expect(
      await run(["pack", "install", "--path", packDirectory], {
        registry: snapshotCommandDefinitions([createInstallCommand(installed.services)]),
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
Changed local content.
`,
    );
    const blocked = new MemoryWriter();
    expect(
      await run(["pack", "install", "--path", packDirectory], {
        registry: snapshotCommandDefinitions([createInstallCommand(installed.services)]),
        stdout: blocked,
      }),
    ).toBe(2);
    expect(JSON.parse(blocked.value)).toMatchObject({ error: { code: "pack.update-required" } });
    expect(
      (await installed.store.readEffectivePractices({ rootPath: storageRoot }))[0]?.practice.body,
    ).toContain("can be decoded and installed");
    const updated = createServices(packDirectory, storageRoot);
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "update", "--path", packDirectory], {
        registry: snapshotCommandDefinitions([createUpdateCommand(updated.services)]),
        stdout,
      }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({ data: { source: { type: "directory" } } });
    expect(response.data.indexSync).toBeUndefined();
    expect(updated.observed.syncedRoots).toEqual([]);
    expect(
      validateJsonSchema(
        response.data,
        snapshotCommandDefinitions([createUpdateCommand(updated.services)])[0]!.resultSchema,
      ),
    ).toEqual([]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("maps unavailable and invalid local Pack roots without exposing their paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
  try {
    const validPack = await createPack(directory);
    const unavailable = join(directory, "missing-pack");
    const notDirectory = join(directory, "not-a-directory");
    const invalidPack = join(directory, "invalid-pack");
    await writeFile(notDirectory, "not a directory\n");
    await mkdir(invalidPack);
    const fixture = createServices(validPack, join(directory, "store"));
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);

    /* eslint-disable no-await-in-loop -- each invocation has its own output assertion. */
    for (const source of [unavailable, notDirectory]) {
      const stdout = new MemoryWriter();
      expect(
        await run(["pack", "install", "--path", source], { registry: definitions, stdout }),
      ).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({ error: { code: "source.unavailable" } });
      expect(stdout.value).not.toContain(source);
    }
    /* eslint-enable no-await-in-loop */
    const invalidOutput = new MemoryWriter();
    expect(
      await run(["pack", "install", "--path", invalidPack], {
        registry: definitions,
        stdout: invalidOutput,
      }),
    ).toBe(2);
    expect(JSON.parse(invalidOutput.value)).toMatchObject({ error: { code: "pack.invalid" } });
    expect(invalidOutput.value).not.toContain(invalidPack);
    expect(fixture.observed.locator).toBeUndefined();
    expect(fixture.observed.repository).toBeUndefined();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("does not roll back a direct directory install when index synchronization fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
  try {
    const storageRoot = join(directory, "store");
    const fixture = createServices(await createPack(directory), storageRoot, "0.1.0", async () => ({
      operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      state: "failed",
      error: "embedding.download-failed",
    }));
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "--path", join(directory, "pack")], {
        registry: snapshotCommandDefinitions([createInstallCommand(fixture.services)]),
        stdout,
      }),
    ).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      data: { source: { type: "directory" }, indexSync: { state: "failed" } },
    });
    expect(await fixture.store.readEffectivePractices({ rootPath: storageRoot })).toHaveLength(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("requires an installed Pack before a direct directory update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
  try {
    const packDirectory = await createPack(directory);
    const fixture = createServices(packDirectory, join(directory, "store"));
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "update", "--path", packDirectory], {
        registry: snapshotCommandDefinitions([createUpdateCommand(fixture.services)]),
        stdout,
      }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({ error: { code: "pack.not-installed" } });
    expect(
      await fixture.store.readEffectivePractices({ rootPath: join(directory, "store") }),
    ).toHaveLength(0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test.each([
  [new StoreBusyError("internal busy path"), "store.busy"],
  [new StoreRecoveryRequiredError("internal recovery path"), "store.recovery-required"],
])(
  "maps Store failures for a direct directory source without exposing internal details",
  async (error, code) => {
    const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
    try {
      const packDirectory = await createPack(directory);
      const fixture = createServices(packDirectory, join(directory, "store"));
      const services: InstallCommandServices = {
        ...fixture.services,
        store: {
          async install() {
            throw error;
          },
          async upgrade() {
            throw error;
          },
        },
      };
      const stdout = new MemoryWriter();
      expect(
        await run(["pack", "install", "--path", packDirectory], {
          registry: snapshotCommandDefinitions([createInstallCommand(services)]),
          stdout,
        }),
      ).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({ error: { code } });
      expect(stdout.value).not.toContain("internal");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test("rejects invalid local source selector combinations before Registry or directory I/O", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-pack-command-"));
  try {
    const packDirectory = await createPack(directory);
    const fixture = createServices(packDirectory, join(directory, "store"));
    const definitions = snapshotCommandDefinitions([createInstallCommand(fixture.services)]);
    /* eslint-disable no-await-in-loop -- each invalid invocation has its own output assertion. */
    for (const invocation of [
      ["pack", "install"],
      ["pack", "install", "--path", ""],
      ["pack", "install", "agentic-coding", "--path", packDirectory],
      ["pack", "install", "--path", packDirectory, "--registry", "team"],
    ]) {
      const stdout = new MemoryWriter();
      expect(await run(invocation, { registry: definitions, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({ error: { code: "usage.invalid" } });
    }
    /* eslint-enable no-await-in-loop */
    expect(fixture.observed.locator).toBeUndefined();
    expect(fixture.observed.repository).toBeUndefined();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("installs from a saved local Git Registry alias without exposing its worktree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-registry-command-"));
  try {
    const packDirectory = await createPack(directory);
    const storageRoot = join(directory, "store");
    const fixture = createServices(packDirectory, storageRoot);
    const localWorktree = "/private/registry-worktree";
    const services: InstallCommandServices = {
      ...fixture.services,
      async selectRegistry() {
        return { kind: "local", alias: "local-team", worktree: localWorktree };
      },
      async loadLocalRegistry() {
        return { registry: registry(), repository: { worktree: localWorktree } };
      },
      async materializeLocalRelease(release) {
        return {
          directory: packDirectory,
          resolvedRef: release.ref,
          resolvedCommit: "0123456789abcdef0123456789abcdef01234567",
          async cleanup() {
            fixture.observed.cleaned += 1;
          },
        };
      },
    };
    const definitions = snapshotCommandDefinitions([createInstallCommand(services)]);
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding"], { registry: definitions, stdout }),
    ).toBe(0);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({
      data: {
        registry: { name: "team-packs", alias: "local-team" },
        source: { type: "local-git", ref: "agentic-coding-v0.1.0" },
      },
    });
    expect(stdout.value).not.toContain(localWorktree);
    expect(validateJsonSchema(response.data, definitions[0]!.resultSchema)).toEqual([]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("does not fall back when a saved local Git Registry source is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-local-registry-command-"));
  try {
    const localWorktree = "/private/registry-worktree";
    const fixture = createServices(await createPack(directory), join(directory, "store"));
    let remoteRegistryCalls = 0;
    const services: InstallCommandServices = {
      ...fixture.services,
      async selectRegistry() {
        return { kind: "local", alias: "local-team", worktree: localWorktree };
      },
      async loadRegistry() {
        remoteRegistryCalls += 1;
        throw new Error("must not fall back to a remote Registry");
      },
      async loadLocalRegistry() {
        throw new CliError(cliErrorCodes.registryUnavailable, "private worktree is gone");
      },
      async materializeLocalRelease() {
        throw new Error("unavailable descriptor must not materialize a release");
      },
    };
    const stdout = new MemoryWriter();
    expect(
      await run(["pack", "install", "agentic-coding"], {
        registry: snapshotCommandDefinitions([createInstallCommand(services)]),
        stdout,
      }),
    ).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({ error: { code: "source.unavailable" } });
    expect(stdout.value).not.toContain(localWorktree);
    expect(remoteRegistryCalls).toBe(0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
