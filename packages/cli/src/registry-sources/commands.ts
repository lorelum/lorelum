import {
  addRegistryCatalogSource,
  readRegistryCatalog,
  removeRegistryCatalogSource,
  setRegistryCatalogDefault,
  RegistryCatalogBusyError,
  RegistryCatalogConflictError,
  RegistryCatalogError,
  RegistryCatalogNotFoundError,
  type AddRegistryCatalogSourceResult,
  type RegistryCatalog,
  type RegistryCatalogSource,
} from "@lorelum/config";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import {
  CliError,
  cliErrorCodes,
  frameworkErrorCodes,
  invalidInvocationError,
} from "../runtime/errors.js";
import { loadLocalRegistry, type LoadedLocalRegistry } from "../install/local-registry.js";
import {
  loadRegistry,
  resolveRegistryRepository,
  type LoadedRegistry,
} from "../install/load-registry.js";

const aliasPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const stringSchema: JsonSchema = { type: "string" };

type CatalogReader = () => Promise<RegistryCatalog>;
type CatalogAdder = (
  alias: string,
  source: RegistryCatalogSource,
) => Promise<AddRegistryCatalogSourceResult>;
type CatalogRemover = (alias: string) => Promise<RegistryCatalog>;
type CatalogDefaultSetter = (alias: string | undefined) => Promise<RegistryCatalog>;

export interface RegistryCommandServices {
  readonly readCatalog?: CatalogReader;
  readonly addCatalogSource?: CatalogAdder;
  readonly removeCatalogSource?: CatalogRemover;
  readonly setCatalogDefault?: CatalogDefaultSetter;
  readonly loadRemoteRegistry?: (locator?: string) => Promise<LoadedRegistry>;
  readonly loadLocalRegistry?: (directory: string) => Promise<LoadedLocalRegistry>;
}

interface ResolvedRegistryCommandServices {
  readonly readCatalog: CatalogReader;
  readonly addCatalogSource: CatalogAdder;
  readonly removeCatalogSource: CatalogRemover;
  readonly setCatalogDefault: CatalogDefaultSetter;
  readonly loadRemoteRegistry: (locator?: string) => Promise<LoadedRegistry>;
  readonly loadLocalRegistry: (directory: string) => Promise<LoadedLocalRegistry>;
}

function resolveServices(services: RegistryCommandServices): ResolvedRegistryCommandServices {
  return {
    readCatalog: services.readCatalog ?? readRegistryCatalog,
    addCatalogSource: services.addCatalogSource ?? addRegistryCatalogSource,
    removeCatalogSource: services.removeCatalogSource ?? removeRegistryCatalogSource,
    setCatalogDefault: services.setCatalogDefault ?? setRegistryCatalogDefault,
    loadRemoteRegistry: services.loadRemoteRegistry ?? loadRegistry,
    loadLocalRegistry: services.loadLocalRegistry ?? loadLocalRegistry,
  };
}

function visibleCatalogError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (error instanceof RegistryCatalogBusyError) {
    throw new CliError(cliErrorCodes.registryCatalogBusy, "The Registry source catalog is busy.");
  }
  if (error instanceof RegistryCatalogConflictError) {
    throw new CliError(
      cliErrorCodes.registryAliasConflict,
      "The Registry alias already points to a different source.",
    );
  }
  if (error instanceof RegistryCatalogNotFoundError) {
    throw new CliError(
      cliErrorCodes.registryAliasNotFound,
      "The Registry alias is not configured.",
    );
  }
  if (error instanceof RegistryCatalogError) {
    throw new CliError(
      cliErrorCodes.registryCatalogInvalid,
      "The Registry source catalog is invalid or unreadable.",
    );
  }
  throw error;
}

function validateAlias(alias: string): void {
  if (!aliasPattern.test(alias) || alias === "official") throw invalidInvocationError();
}

function optionString(
  options: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function sourceSummary(
  alias: string,
  source: RegistryCatalogSource,
  defaultAlias: string | undefined,
): JsonValue {
  if (source.kind === "remote-git") {
    const repository = resolveRegistryRepository(source.locator);
    return {
      alias,
      type: "remote-git",
      repository: repository.slug,
      default: defaultAlias === alias,
    };
  }
  return { alias, type: "local-git", default: defaultAlias === alias };
}

function catalogListData(catalog: RegistryCatalog): JsonValue {
  try {
    return {
      default: catalog.defaultAlias ?? "official",
      sources: [
        {
          alias: "official",
          type: "remote-git",
          repository: resolveRegistryRepository().slug,
          default: catalog.defaultAlias === undefined,
        },
        ...Object.entries(catalog.registries)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([alias, source]) => sourceSummary(alias, source, catalog.defaultAlias)),
      ],
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw new CliError(
        cliErrorCodes.registryCatalogInvalid,
        "The Registry source catalog is invalid or unreadable.",
      );
    }
    throw error;
  }
}

const catalogErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.registryAliasConflict,
  cliErrorCodes.registryAliasNotFound,
  cliErrorCodes.registryCatalogBusy,
  cliErrorCodes.registryCatalogInvalid,
  cliErrorCodes.registryInvalid,
  cliErrorCodes.registryUnavailable,
]);

const sourceSummarySchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["alias", "type", "repository", "default"],
      properties: {
        alias: stringSchema,
        type: { const: "remote-git" },
        repository: stringSchema,
        default: { type: "boolean" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["alias", "type", "default"],
      properties: {
        alias: stringSchema,
        type: { const: "local-git" },
        default: { type: "boolean" },
      },
    },
  ],
};

const listResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["default", "sources"],
  properties: { default: stringSchema, sources: { type: "array", items: sourceSummarySchema } },
};

const addResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "idempotent"],
  properties: { source: sourceSummarySchema, idempotent: { type: "boolean" } },
};

const defaultResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["default"],
  properties: { default: stringSchema },
};

const removeResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["removed", "default"],
  properties: { removed: stringSchema, default: stringSchema },
};

function createAddCommand(services: ResolvedRegistryCommandServices): CommandDefinition {
  return {
    name: "registry.add",
    summary: "Save one validated Registry source under a local alias.",
    positionals: [
      { name: "alias", required: true },
      { name: "locator", required: false },
    ],
    options: [
      {
        longFlag: "--path",
        description: "Use a local Git worktree containing .lorelum/registry.yaml.",
        value: { name: "repository", required: true },
        optionRequired: false,
      },
    ],
    resultSchema: addResultSchema,
    errorCodes: catalogErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const alias = invocation.positionals[0]!;
        const locator = invocation.positionals[1];
        const path = optionString(invocation.options, "path");
        validateAlias(alias);
        if ((locator === undefined) === (path === undefined) || path === "")
          throw invalidInvocationError();

        if (locator !== undefined) {
          const loaded = await services.loadRemoteRegistry(locator);
          const added = await services.addCatalogSource(alias, {
            kind: "remote-git",
            locator: loaded.repository.gitUrl,
          });
          return {
            data: {
              source: sourceSummary(
                alias,
                { kind: "remote-git", locator: loaded.repository.gitUrl },
                added.catalog.defaultAlias,
              ),
              idempotent: added.idempotent,
            },
          };
        }

        const loaded = await services.loadLocalRegistry(path!);
        const added = await services.addCatalogSource(alias, {
          kind: "local-git",
          worktree: loaded.repository.worktree,
        });
        return {
          data: {
            source: sourceSummary(
              alias,
              { kind: "local-git", worktree: loaded.repository.worktree },
              added.catalog.defaultAlias,
            ),
            idempotent: added.idempotent,
          },
        };
      } catch (error) {
        visibleCatalogError(error);
      }
    },
  };
}

function createListCommand(services: ResolvedRegistryCommandServices): CommandDefinition {
  return {
    name: "registry.list",
    summary: "List the built-in and saved Registry sources without accessing remotes.",
    positionals: [],
    options: [],
    resultSchema: listResultSchema,
    errorCodes: catalogErrorCodes,
    exitCodes: [0, 2],
    async handler() {
      try {
        return { data: catalogListData(await services.readCatalog()) };
      } catch (error) {
        visibleCatalogError(error);
      }
    },
  };
}

function createRemoveCommand(services: ResolvedRegistryCommandServices): CommandDefinition {
  return {
    name: "registry.remove",
    summary: "Remove one saved Registry source.",
    positionals: [{ name: "alias", required: true }],
    options: [],
    resultSchema: removeResultSchema,
    errorCodes: catalogErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const alias = invocation.positionals[0]!;
        validateAlias(alias);
        const catalog = await services.removeCatalogSource(alias);
        return { data: { removed: alias, default: catalog.defaultAlias ?? "official" } };
      } catch (error) {
        visibleCatalogError(error);
      }
    },
  };
}

function createSetDefaultCommand(services: ResolvedRegistryCommandServices): CommandDefinition {
  return {
    name: "registry.set-default",
    summary: "Select the default Registry source for Pack mutations.",
    positionals: [{ name: "alias|official", required: true }],
    options: [],
    resultSchema: defaultResultSchema,
    errorCodes: catalogErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const alias = invocation.positionals[0]!;
        if (alias !== "official") validateAlias(alias);
        const catalog = await services.setCatalogDefault(alias === "official" ? undefined : alias);
        return { data: { default: catalog.defaultAlias ?? "official" } };
      } catch (error) {
        visibleCatalogError(error);
      }
    },
  };
}

export function createRegistryCommands(
  services: RegistryCommandServices = {},
): readonly CommandDefinition[] {
  const resolved = resolveServices(services);
  return [
    createAddCommand(resolved),
    createListCommand(resolved),
    createRemoveCommand(resolved),
    createSetDefaultCommand(resolved),
  ];
}
