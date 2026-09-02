import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";
import { RegistrySchema, type RegistryRelease } from "@lorelum/format";

import { run } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { snapshotCommandDefinitions } from "../registry.js";
import { createInstallCommand, type InstallCommandServices } from "./install-command.js";
import { resolveRegistryRepository } from "./load-registry.js";

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
): {
  services: InstallCommandServices;
  observed: { cleaned: number; locator: string | undefined; repository: string | undefined };
} {
  const observed = { cleaned: 0, locator: undefined, repository: undefined } as {
    cleaned: number;
    locator: string | undefined;
    repository: string | undefined;
  };
  return {
    observed,
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
      store: createLocalStore(),
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
      await run(
        ["install", "agentic-coding", "--registry", "acme/team-packs", "--pack-version", "0.1.0"],
        { registry: definitions, stdout: firstOutput },
      ),
    ).toBe(0);
    const first = JSON.parse(firstOutput.value);
    expect(first).toMatchObject({
      ok: true,
      command: "install",
      data: {
        registry: { name: "team-packs", repository: "acme/team-packs" },
        pack: { name: "agentic-coding", version: "0.1.0" },
        idempotent: false,
        generation: 1,
        effectiveRevision: 1,
        delta: { added: ["agentic-coding.installation.placeholder"] },
      },
    });
    expect(first.data.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.observed.locator).toBe("acme/team-packs");
    expect(fixture.observed.repository).toBe("https://github.com/acme/team-packs.git");
    const installDefinition = definitions.find((definition) => definition.name === "install")!;
    expect(validateJsonSchema(first.data, installDefinition.resultSchema)).toEqual([]);

    const secondOutput = new MemoryWriter();
    expect(
      await run(["install", "agentic-coding", "--registry", "acme/team-packs"], {
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
        delta: { added: [], changed: [], invalidated: [] },
      },
    });
    expect(fixture.observed.cleaned).toBe(2);
    expect(
      await fixture.services.store.readEffectivePractices({ rootPath: storageRoot }),
    ).toHaveLength(1);
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
      await run(["--store-root", isolatedRoot, "install", "agentic-coding"], {
        registry: definitions,
        stdout: firstOutput,
      }),
    ).toBe(0);
    expect(JSON.parse(firstOutput.value)).toMatchObject({ data: { idempotent: false } });
    expect(existsSync(defaultRoot)).toBe(false);
    expect(
      await fixture.services.store.readEffectivePractices({ rootPath: isolatedRoot }),
    ).toHaveLength(1);

    const secondOutput = new MemoryWriter();
    expect(
      await run(["install", "agentic-coding", "--store-root", isolatedRoot], {
        registry: definitions,
        stdout: secondOutput,
      }),
    ).toBe(0);
    expect(JSON.parse(secondOutput.value)).toMatchObject({ data: { idempotent: true } });
    expect(existsSync(defaultRoot)).toBe(false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a changed installed Pack requires an explicit upgrade", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-install-command-"));
  try {
    const packDirectory = await createPack(directory);
    const storageRoot = join(directory, "store");
    const first = createServices(packDirectory, storageRoot);
    const firstDefinitions = snapshotCommandDefinitions([createInstallCommand(first.services)]);
    expect(
      await run(["install", "agentic-coding"], {
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
    expect(await run(["install", "agentic-coding"], { registry: definitions, stdout })).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      ok: false,
      error: { code: "pack.upgrade-required" },
    });
    const effective = await first.services.store.readEffectivePractices({ rootPath: storageRoot });
    expect(effective[0]?.practice.body).toContain("can be decoded and installed");
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
    expect(await run(["install", "agentic-coding"], { registry: definitions, stdout })).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({
      ok: false,
      error: { code: "pack.invalid" },
    });
    expect(fixture.observed.cleaned).toBe(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
