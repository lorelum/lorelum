import {
  InvalidSourcePathError,
  PackNotInstalledError,
  PackValidationError,
  PracticeConflictError,
  SnapshotFormatError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  UpgradeRequiredError,
  decodePackDirectory,
  type DecodedPackDirectory,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";
import type { RegistryRelease } from "@lorelum/format";
import type { IndexRuntimeClient } from "@lorelum/backend/coordination";
import { lstat, opendir, realpath } from "node:fs/promises";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { OutputWriter } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, cliErrorCodes, frameworkErrorCodes } from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import {
  mutationResultProperties,
  mutationResultRequired,
  stringSchema,
  toMutationResultData,
} from "../store/mutation-result.js";
import { loadRegistry, type LoadedRegistry } from "./load-registry.js";
import { loadLocalRegistry, type LoadedLocalRegistry } from "./local-registry.js";
import {
  materializeLocalRegistryRelease,
  materializeRegistryRelease,
  type MaterializedPackSource,
} from "./materialize-source.js";
import { parsePackSpecifier } from "./pack-specifier.js";
import { selectRegistry, type RegistrySelection } from "./registry-selection.js";
import { resolveRegistryRelease } from "./resolve-release.js";
import {
  failedInstallIndexSync,
  type InstallIndexSync,
  syncSemanticIndexAfterInstall,
} from "./sync-semantic-index.js";

export interface InstallCommandServices {
  /** Core storage dependencies are supplied by the CLI composition root. */
  readonly store: Pick<LocalStore, "install" | "upgrade">;
  readonly storageRoot: StorageRoot;
  /** Install submits derived-index synchronization after its canonical commit. */
  readonly createIndexRuntimeClient: () => Promise<IndexRuntimeClient>;
  readonly progressWriter?: OutputWriter;
  /** Ancillary dependencies default to the production implementations. */
  readonly loadRegistry?: (locator?: string) => Promise<LoadedRegistry>;
  readonly loadLocalRegistry?: (directory: string) => Promise<LoadedLocalRegistry>;
  readonly selectRegistry?: (selector?: string) => Promise<RegistrySelection>;
  readonly materializeRelease?: (
    release: RegistryRelease,
    repository: string,
  ) => Promise<MaterializedPackSource>;
  readonly materializeLocalRelease?: (
    release: RegistryRelease,
    worktree: string,
  ) => Promise<MaterializedPackSource>;
  readonly decodePackDirectory?: (directory: string) => Promise<DecodedPackDirectory>;
  readonly resolveLocalPackDirectory?: (directory: string) => Promise<string>;
}

type ResolvedInstallCommandServices = Required<InstallCommandServices>;

const indexSyncSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "operationId", "phase"],
      properties: {
        state: { const: "pending" },
        operationId: stringSchema,
        phase: { enum: ["preparing", "building"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "index"],
      properties: {
        state: { const: "ready" },
        index: {
          type: "object",
          additionalProperties: false,
          required: ["state", "profileId"],
          properties: {
            state: { enum: ["ready"] },
            profileId: stringSchema,
            vectorCount: { type: "integer" },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "error"],
      properties: {
        state: { const: "failed" },
        error: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: { code: stringSchema, message: stringSchema },
        },
      },
    },
  ],
};

const registryResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["name", "repository"],
      properties: { name: stringSchema, repository: stringSchema, alias: stringSchema },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["name", "alias"],
      properties: { name: stringSchema, alias: stringSchema },
    },
  ],
};

const registrySourceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "ref", "commit"],
  properties: {
    type: { enum: ["git", "local-git"] },
    ref: stringSchema,
    commit: stringSchema,
  },
};

const directorySourceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: { type: { const: "directory" } },
};

const packResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version"],
  properties: { name: stringSchema, version: stringSchema },
};

const mutationResultDataProperties = {
  pack: packResultSchema,
  ...mutationResultProperties,
  idempotent: { type: "boolean" },
  artifactDigest: stringSchema,
  packRoot: stringSchema,
} satisfies Readonly<Record<string, JsonSchema>>;

const mutationResultDataRequired = [
  "pack",
  ...mutationResultRequired,
  "idempotent",
  "artifactDigest",
  "packRoot",
];

const registryMutationBranch: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["registry", "source", ...mutationResultDataRequired],
  properties: {
    ...mutationResultDataProperties,
    registry: registryResultSchema,
    source: registrySourceSchema,
  },
};

const directoryMutationBranch: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", ...mutationResultDataRequired],
  properties: {
    ...mutationResultDataProperties,
    source: directorySourceSchema,
  },
};

const registryMutationResultSchema: JsonSchema = {
  oneOf: [registryMutationBranch, directoryMutationBranch],
};

const installResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["registry", "source", ...mutationResultDataRequired, "indexSync"],
      properties: {
        ...mutationResultDataProperties,
        registry: registryResultSchema,
        source: registrySourceSchema,
        indexSync: indexSyncSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["source", ...mutationResultDataRequired, "indexSync"],
      properties: {
        ...mutationResultDataProperties,
        source: directorySourceSchema,
        indexSync: indexSyncSchema,
      },
    },
  ],
};

const registryMutationErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.registryAliasNotFound,
  cliErrorCodes.registryCatalogBusy,
  cliErrorCodes.registryCatalogInvalid,
  cliErrorCodes.registryUnavailable,
  cliErrorCodes.registryInvalid,
  cliErrorCodes.registryPackNotFound,
  cliErrorCodes.registryVersionNotFound,
  cliErrorCodes.sourceUnavailable,
  cliErrorCodes.sourceInvalid,
  cliErrorCodes.packInvalid,
  cliErrorCodes.practiceConflict,
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
]);

const installErrorCodes = Object.freeze([
  ...registryMutationErrorCodes,
  cliErrorCodes.packUpdateRequired,
]);

const updateErrorCodes = Object.freeze([
  ...registryMutationErrorCodes,
  cliErrorCodes.packNotInstalled,
]);

function optionString(
  options: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

async function resolveLocalPackDirectory(directory: string): Promise<string> {
  try {
    const resolved = await realpath(directory);
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("not a directory");
    const handle = await opendir(resolved);
    await handle.close();
    return resolved;
  } catch {
    throw new CliError(
      cliErrorCodes.sourceUnavailable,
      "The local Pack directory is unavailable. Confirm the directory and retry.",
    );
  }
}

function throwVisibleRegistryMutationError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (
    error instanceof SnapshotFormatError ||
    error instanceof PackValidationError ||
    error instanceof InvalidSourcePathError
  ) {
    throw new CliError(cliErrorCodes.packInvalid, "The selected Pack is invalid.");
  }
  if (error instanceof UpgradeRequiredError) {
    throw new CliError(
      cliErrorCodes.packUpdateRequired,
      "The selected Pack has changed; use `lore pack update` to replace it.",
    );
  }
  if (error instanceof PackNotInstalledError) {
    throw new CliError(cliErrorCodes.packNotInstalled, "The specified Pack is not installed.");
  }
  if (error instanceof PracticeConflictError) {
    throw new CliError(
      cliErrorCodes.practiceConflict,
      `Practice "${error.practiceId}" conflicts with an installed Pack.`,
    );
  }
  if (error instanceof StoreBusyError) {
    throw new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
  }
  if (error instanceof StoreRecoveryRequiredError) {
    throw new CliError(
      cliErrorCodes.storeRecoveryRequired,
      "The local Pack store requires recovery.",
    );
  }
  throw error;
}

type RegistryMutationOperation = "install" | "update";

async function mutateRegistryPack(
  services: ResolvedInstallCommandServices,
  storageRoot: StorageRoot,
  packName: string,
  requestedVersion?: string,
  registryLocator?: string,
  operation: RegistryMutationOperation = "install",
): Promise<JsonValue> {
  const selection = await services.selectRegistry(registryLocator);
  let resolved: ReturnType<typeof resolveRegistryRelease>;
  let materialized: MaterializedPackSource;
  let registry: JsonValue;
  let sourceType: "git" | "local-git";
  if (selection.kind === "remote") {
    const loaded = await services.loadRegistry(selection.locator);
    resolved = resolveRegistryRelease(loaded.registry, packName, requestedVersion);
    materialized = await services.materializeRelease(resolved.release, loaded.repository.gitUrl);
    registry = {
      name: loaded.registry.name,
      repository: loaded.repository.slug,
      ...(selection.alias === undefined || selection.alias === "official"
        ? {}
        : { alias: selection.alias }),
    };
    sourceType = "git";
  } else {
    let loaded: LoadedLocalRegistry;
    try {
      loaded = await services.loadLocalRegistry(selection.worktree);
    } catch (error) {
      // A saved local Registry is an explicit source. If its worktree or a
      // promised descriptor object is no longer readable, do not report it as
      // a generic Registry lookup or try a different source.
      if (error instanceof CliError && error.code === cliErrorCodes.registryUnavailable) {
        throw new CliError(cliErrorCodes.sourceUnavailable, "The Pack source is unavailable.");
      }
      throw error;
    }
    resolved = resolveRegistryRelease(loaded.registry, packName, requestedVersion);
    materialized = await services.materializeLocalRelease(resolved.release, selection.worktree);
    registry = { name: loaded.registry.name, alias: selection.alias };
    sourceType = "local-git";
  }
  try {
    const decoded = await services.decodePackDirectory(materialized.directory);
    if (
      decoded.candidate.pack.name !== resolved.pack.name ||
      decoded.candidate.pack.version !== resolved.release.version
    ) {
      throw new CliError(
        cliErrorCodes.packInvalid,
        "The fetched Pack identity does not match the Registry release.",
      );
    }
    const result = await services.store[operation === "update" ? "upgrade" : "install"](
      storageRoot,
      decoded.candidate,
      decoded.diagnostics,
    );
    const data = {
      pack: { name: decoded.candidate.pack.name, version: decoded.candidate.pack.version },
      registry,
      source: {
        type: sourceType,
        ref: materialized.resolvedRef,
        commit: materialized.resolvedCommit,
      },
      ...toMutationResultData(result),
      idempotent: result.idempotent,
      cleanupPending: result.cleanupPending,
      artifactDigest: result.artifactDigest,
      packRoot: result.packRoot,
    };
    return appendInstallIndexSync(services, storageRoot, operation, data);
  } finally {
    await materialized.cleanup().catch(() => undefined);
  }
}

async function mutateDirectoryPack(
  services: ResolvedInstallCommandServices,
  storageRoot: StorageRoot,
  sourceDirectory: string,
  operation: RegistryMutationOperation,
): Promise<JsonValue> {
  const directory = await services.resolveLocalPackDirectory(sourceDirectory);
  const decoded = await services.decodePackDirectory(directory);
  const result = await services.store[operation === "update" ? "upgrade" : "install"](
    storageRoot,
    decoded.candidate,
    decoded.diagnostics,
  );
  const data = {
    pack: { name: decoded.candidate.pack.name, version: decoded.candidate.pack.version },
    source: { type: "directory" },
    ...toMutationResultData(result),
    idempotent: result.idempotent,
    cleanupPending: result.cleanupPending,
    artifactDigest: result.artifactDigest,
    packRoot: result.packRoot,
  };
  return appendInstallIndexSync(services, storageRoot, operation, data);
}

async function appendInstallIndexSync(
  services: ResolvedInstallCommandServices,
  root: StorageRoot,
  operation: RegistryMutationOperation,
  data: Readonly<Record<string, JsonValue>>,
): Promise<JsonValue> {
  if (operation !== "install") return data;
  const indexSync = await synchronizeIndex(services, root);
  if (indexSync.state === "failed") {
    try {
      services.progressWriter.write("index: sync failed; run lore index build for this Store\n");
    } catch {
      /* Closed stderr must not change the canonical install result. */
    }
  }
  return { ...data, indexSync };
}

async function synchronizeIndex(
  services: ResolvedInstallCommandServices,
  root: StorageRoot,
): Promise<InstallIndexSync> {
  try {
    return await syncSemanticIndexAfterInstall(root, await services.createIndexRuntimeClient());
  } catch (error) {
    return failedInstallIndexSync(error);
  }
}

function createRegistryMutationCommand(
  operation: RegistryMutationOperation,
  services: InstallCommandServices,
): CommandDefinition {
  const resolvedServices = {
    loadRegistry: services.loadRegistry ?? loadRegistry,
    loadLocalRegistry: services.loadLocalRegistry ?? loadLocalRegistry,
    selectRegistry: services.selectRegistry ?? selectRegistry,
    materializeRelease: services.materializeRelease ?? materializeRegistryRelease,
    materializeLocalRelease: services.materializeLocalRelease ?? materializeLocalRegistryRelease,
    decodePackDirectory: services.decodePackDirectory ?? decodePackDirectory,
    resolveLocalPackDirectory: services.resolveLocalPackDirectory ?? resolveLocalPackDirectory,
    createIndexRuntimeClient: services.createIndexRuntimeClient,
    progressWriter: services.progressWriter ?? process.stderr,
    store: services.store,
    storageRoot: services.storageRoot,
  };
  return {
    name: `pack.${operation}`,
    summary:
      operation === "install"
        ? "Install a Knowledge Pack into the selected local Store."
        : "Update an installed Knowledge Pack in the selected local Store.",
    positionals: [{ name: "pack[@version]", required: false }],
    options: [
      {
        longFlag: "--registry",
        description: "Use a saved Registry alias or a supported remote Git repository.",
        value: { name: "source", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--path",
        description: "Install or update from one explicit local Pack directory.",
        value: { name: "directory", required: true },
        optionRequired: false,
      },
    ],
    resultSchema: operation === "install" ? installResultSchema : registryMutationResultSchema,
    errorCodes: operation === "install" ? installErrorCodes : updateErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const sourceDirectory = optionString(invocation.options, "path");
        const registry = optionString(invocation.options, "registry");
        const packSpecifier = invocation.positionals[0];
        const storageRoot = resolveInvocationStorageRoot(
          invocation.options.storeRoot,
          resolvedServices.storageRoot,
        );
        if (sourceDirectory !== undefined) {
          if (sourceDirectory === "" || packSpecifier !== undefined || registry !== undefined) {
            throw new CliError(cliErrorCodes.usageInvalid, "The command invocation is invalid.");
          }
          return {
            data: await mutateDirectoryPack(
              resolvedServices,
              storageRoot,
              sourceDirectory,
              operation,
            ),
          };
        }
        if (packSpecifier === undefined) {
          throw new CliError(cliErrorCodes.usageInvalid, "The command invocation is invalid.");
        }
        // Validate the compact Pack reference before touching the Registry or Store.
        const specifier = parsePackSpecifier(packSpecifier);
        return {
          data: await mutateRegistryPack(
            resolvedServices,
            storageRoot,
            specifier.packName,
            specifier.requestedVersion,
            registry,
            operation,
          ),
        };
      } catch (error) {
        throwVisibleRegistryMutationError(error);
      }
    },
  };
}

export function createInstallCommand(services: InstallCommandServices): CommandDefinition {
  return createRegistryMutationCommand("install", services);
}

export function createUpdateCommand(services: InstallCommandServices): CommandDefinition {
  return createRegistryMutationCommand("update", services);
}
