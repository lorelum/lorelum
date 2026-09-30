import { expect, test } from "bun:test";

import { RegistrySchema } from "@lorelum/format";
import {
  RegistryCatalogConflictError,
  RegistryCatalogNotFoundError,
  type RegistryCatalog,
} from "@lorelum/config";

import { run as runCli } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import { snapshotCommandDefinitions } from "../registry.js";
import { resolveRegistryRepository } from "../install/load-registry.js";
import { createRegistryCommands, type RegistryCommandServices } from "./commands.js";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const descriptor = RegistrySchema.parse({ schema_version: 1, name: "team-packs", packs: [] });

function createServices(): {
  services: RegistryCommandServices;
  catalog: { value: RegistryCatalog };
} {
  const catalog = { value: { registries: {} } as RegistryCatalog };
  const services: RegistryCommandServices = {
    async readCatalog() {
      return catalog.value;
    },
    async addCatalogSource(alias, source) {
      const existing = catalog.value.registries[alias];
      if (existing !== undefined) {
        return { catalog: catalog.value, idempotent: true };
      }
      catalog.value = {
        ...(catalog.value.defaultAlias === undefined
          ? {}
          : { defaultAlias: catalog.value.defaultAlias }),
        registries: { ...catalog.value.registries, [alias]: source },
      };
      return { catalog: catalog.value, idempotent: false };
    },
    async removeCatalogSource(alias) {
      const registries = { ...catalog.value.registries };
      delete registries[alias];
      catalog.value = {
        ...(catalog.value.defaultAlias === alias
          ? {}
          : { defaultAlias: catalog.value.defaultAlias }),
        registries,
      };
      return catalog.value;
    },
    async setCatalogDefault(alias) {
      catalog.value = {
        ...(alias === undefined ? {} : { defaultAlias: alias }),
        registries: catalog.value.registries,
      };
      return catalog.value;
    },
    async loadRemoteRegistry(locator) {
      return { registry: descriptor, repository: resolveRegistryRepository(locator) };
    },
    async loadLocalRegistry() {
      return { registry: descriptor, repository: { worktree: "/private/registry-worktree" } };
    },
  };
  return { services, catalog };
}

test("manages remote aliases through JSON command definitions", async () => {
  const fixture = createServices();
  const definitions = snapshotCommandDefinitions(createRegistryCommands(fixture.services));
  const stdout = new MemoryWriter();

  expect(
    await run(["registry", "add", "team", "https://gitlab.example.com/acme/packs.git"], {
      registry: definitions,
      stdout,
    }),
  ).toBe(0);
  const added = JSON.parse(stdout.value);
  expect(added).toMatchObject({
    command: "registry.add",
    ok: true,
    data: {
      source: {
        alias: "team",
        type: "remote-git",
        repository: "https://gitlab.example.com/acme/packs.git",
      },
      idempotent: false,
    },
  });
  expect(validateJsonSchema(added.data, definitions[0]!.resultSchema)).toEqual([]);

  const setDefault = new MemoryWriter();
  expect(
    await run(["registry", "set-default", "team"], { registry: definitions, stdout: setDefault }),
  ).toBe(0);
  expect(JSON.parse(setDefault.value)).toMatchObject({ data: { default: "team" } });

  const listed = new MemoryWriter();
  expect(await run(["registry", "list"], { registry: definitions, stdout: listed })).toBe(0);
  const listResponse = JSON.parse(listed.value);
  expect(listResponse.data.default).toBe("team");
  expect(listResponse.data.sources.map((source: { alias: string }) => source.alias)).toEqual([
    "official",
    "team",
  ]);
});

test("registers a local Git worktree without returning its private path", async () => {
  const fixture = createServices();
  const definitions = snapshotCommandDefinitions(createRegistryCommands(fixture.services));
  const stdout = new MemoryWriter();

  expect(
    await run(["registry", "add", "local", "--path", "./registry"], {
      registry: definitions,
      stdout,
    }),
  ).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ data: { source: { alias: "local", type: "local-git" } } });
  expect(stdout.value).not.toContain("/private/registry-worktree");
});

test("rejects ambiguous Registry add forms before calling source loaders", async () => {
  const fixture = createServices();
  const definitions = snapshotCommandDefinitions(createRegistryCommands(fixture.services));
  const stdout = new MemoryWriter();

  expect(
    await run(
      ["registry", "add", "team", "https://git.example.com/team/packs.git", "--path", "./registry"],
      {
        registry: definitions,
        stdout,
      },
    ),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({ error: { code: "usage.invalid" } });
});

test("maps unknown aliases without changing source catalog state", async () => {
  const fixture = createServices();
  const definitions = snapshotCommandDefinitions(
    createRegistryCommands({
      ...fixture.services,
      async removeCatalogSource() {
        throw new RegistryCatalogNotFoundError();
      },
      async setCatalogDefault() {
        throw new RegistryCatalogNotFoundError();
      },
    }),
  );
  /* eslint-disable no-await-in-loop -- each command has its own envelope assertion. */
  for (const invocation of [
    ["registry", "remove", "missing"],
    ["registry", "set-default", "missing"],
  ]) {
    const stdout = new MemoryWriter();
    expect(await run(invocation, { registry: definitions, stdout })).toBe(2);
    expect(JSON.parse(stdout.value)).toMatchObject({ error: { code: "registry.alias-not-found" } });
  }
  /* eslint-enable no-await-in-loop */
  expect(fixture.catalog.value).toEqual({ registries: {} });
});

test("keeps the built-in official source protected and maps alias conflicts", async () => {
  const fixture = createServices();
  const definitions = snapshotCommandDefinitions(
    createRegistryCommands({
      ...fixture.services,
      async addCatalogSource() {
        throw new RegistryCatalogConflictError();
      },
    }),
  );
  const official = new MemoryWriter();
  expect(
    await run(["registry", "remove", "official"], { registry: definitions, stdout: official }),
  ).toBe(2);
  expect(JSON.parse(official.value)).toMatchObject({ error: { code: "usage.invalid" } });

  const conflict = new MemoryWriter();
  expect(
    await run(["registry", "add", "team", "https://gitlab.example.com/acme/packs.git"], {
      registry: definitions,
      stdout: conflict,
    }),
  ).toBe(2);
  expect(JSON.parse(conflict.value)).toMatchObject({ error: { code: "registry.alias-conflict" } });
  expect(fixture.catalog.value).toEqual({ registries: {} });
});
