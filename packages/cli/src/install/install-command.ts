import {
  InvalidSourcePathError,
  PackValidationError,
  PracticeConflictError,
  SnapshotFormatError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  UpgradeRequiredError,
  createLocalStore,
  decodePackDirectory,
  defaultStorageRoot,
  type DecodedPackDirectory,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";
import type { RegistryRelease } from "@lorelum/format";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, cliErrorCodes, frameworkErrorCodes } from "../runtime/errors.js";
import { loadRegistry, type LoadedRegistry } from "./load-registry.js";
import { materializeRegistryRelease, type MaterializedPackSource } from "./materialize-source.js";
import { resolveRegistryRelease } from "./resolve-release.js";

export interface InstallCommandServices {
  readonly loadRegistry: (locator?: string) => Promise<LoadedRegistry>;
  readonly materializeRelease: (
    release: RegistryRelease,
    repository: string,
  ) => Promise<MaterializedPackSource>;
  readonly decodePackDirectory: (directory: string) => Promise<DecodedPackDirectory>;
  readonly store: LocalStore;
  readonly storageRoot: StorageRoot;
}

function defaultInstallServices(): InstallCommandServices {
  return {
    loadRegistry,
    materializeRelease: materializeRegistryRelease,
    decodePackDirectory,
    store: createLocalStore(),
    storageRoot: defaultStorageRoot(),
  };
}

const stringSchema: JsonSchema = { type: "string" };
const stringArraySchema: JsonSchema = { type: "array", items: stringSchema };
const deltaSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["added", "changed", "invalidated"],
  properties: {
    added: stringArraySchema,
    changed: stringArraySchema,
    invalidated: stringArraySchema,
  },
};
const diagnosticSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["level", "code", "path", "message"],
  properties: {
    level: { enum: ["error", "warning", "info"] },
    code: stringSchema,
    path: stringSchema,
    message: stringSchema,
  },
};
const installResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "pack",
    "registry",
    "source",
    "generation",
    "effectiveRevision",
    "delta",
    "diagnostics",
    "idempotent",
    "cleanupPending",
    "artifactDigest",
  ],
  properties: {
    pack: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version"],
      properties: { name: stringSchema, version: stringSchema },
    },
    registry: {
      type: "object",
      additionalProperties: false,
      required: ["name", "repository"],
      properties: { name: stringSchema, repository: stringSchema },
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ref", "commit"],
      properties: { type: { const: "git" }, ref: stringSchema, commit: stringSchema },
    },
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    delta: deltaSchema,
    diagnostics: { type: "array", items: diagnosticSchema },
    idempotent: { type: "boolean" },
    cleanupPending: { type: "boolean" },
    artifactDigest: stringSchema,
  },
};

const installErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.registryUnavailable,
  cliErrorCodes.registryInvalid,
  cliErrorCodes.registryPackNotFound,
  cliErrorCodes.registryVersionNotFound,
  cliErrorCodes.sourceUnavailable,
  cliErrorCodes.sourceInvalid,
  cliErrorCodes.packInvalid,
  cliErrorCodes.packUpgradeRequired,
  cliErrorCodes.practiceConflict,
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
]);

function optionString(
  options: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function throwVisibleInstallError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (
    error instanceof SnapshotFormatError ||
    error instanceof PackValidationError ||
    error instanceof InvalidSourcePathError
  ) {
    throw new CliError(cliErrorCodes.packInvalid, "The selected Pack is invalid.");
  }
  if (error instanceof UpgradeRequiredError) {
    throw new CliError(cliErrorCodes.packUpgradeRequired, error.message);
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

async function installPack(
  services: InstallCommandServices,
  packName: string,
  requestedVersion?: string,
  registryLocator?: string,
): Promise<JsonValue> {
  const loaded = await services.loadRegistry(registryLocator);
  const resolved = resolveRegistryRelease(loaded.registry, packName, requestedVersion);
  const materialized = await services.materializeRelease(
    resolved.release,
    loaded.repository.gitUrl,
  );
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
    const result = await services.store.install(
      services.storageRoot,
      decoded.candidate,
      decoded.diagnostics,
    );
    return {
      pack: { name: decoded.candidate.pack.name, version: decoded.candidate.pack.version },
      registry: { name: loaded.registry.name, repository: loaded.repository.slug },
      source: {
        type: "git",
        ref: materialized.resolvedRef,
        commit: materialized.resolvedCommit,
      },
      generation: result.generation,
      effectiveRevision: result.effectiveRevision,
      delta: {
        added: [...result.delta.added],
        changed: [...result.delta.changed],
        invalidated: [...result.delta.invalidated],
      },
      diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      idempotent: result.idempotent,
      cleanupPending: result.cleanupPending,
      artifactDigest: result.artifactDigest,
    };
  } finally {
    await materialized.cleanup().catch(() => undefined);
  }
}

export function createInstallCommand(
  services: InstallCommandServices = defaultInstallServices(),
): CommandDefinition {
  return {
    name: "install",
    summary: "Install a Knowledge Pack into the user-level local store.",
    positionals: [{ name: "pack", required: true }],
    options: [
      {
        longFlag: "--pack-version",
        description: "Install one exact Registry release version.",
        value: { name: "version", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--registry",
        description: "Use a GitHub repository containing .lorelum/registry.yaml.",
        value: { name: "repository", required: true },
        optionRequired: false,
      },
    ],
    resultSchema: installResultSchema,
    errorCodes: installErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        return {
          data: await installPack(
            services,
            invocation.positionals[0]!,
            optionString(invocation.options, "packVersion"),
            optionString(invocation.options, "registry"),
          ),
        };
      } catch (error) {
        throwVisibleInstallError(error);
      }
    },
  };
}
