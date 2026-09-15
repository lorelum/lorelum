import type { BackendClient } from "@lorelum/backend/client";
import type { IndexRuntimeClient } from "@lorelum/backend/coordination";
import {
  BackendError,
  backendErrorCodes,
  BackendRemoteError,
  embeddingErrorCodes,
  EmbeddingError,
  indexOperationStoreErrorCodes,
  type IndexOperation,
  type IndexStatus,
} from "@lorelum/backend/protocol";
import type { StorageRoot } from "@lorelum/engine";
import { InvalidProjectRootError } from "@lorelum/engine";

import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { CliError, frameworkErrorCodes } from "../runtime/errors";
import { resolveInvocationStorageRoot } from "../store/storage-root";
import {
  resolveProjectInvocationOptions,
  type ProjectContextResolver,
} from "../project-context/service";

export interface IndexCommandServices {
  /** Read-only status keeps its existing non-starting Backend path. */
  readonly createClient: () => Promise<BackendClient>;
  /** Build/rebuild observe Backend-owned execution without waiting for model downloads. */
  readonly createRuntimeClient: () => Promise<IndexRuntimeClient>;
  readonly storageRoot: StorageRoot;
  readonly resolveProjectContext?: ProjectContextResolver;
}

const indexStatusResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "profileId"],
  properties: {
    state: { enum: ["missing", "indexing", "ready", "stale", "incompatible"] },
    profileId: { type: "string" },
    vectorCount: { type: "integer" },
    operationId: { type: "string" },
    indexedPracticeCount: { type: "integer" },
    totalPracticeCount: { type: "integer" },
  },
};

const indexOperationResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "state", "preparationId"],
      properties: {
        operationId: { type: "string" },
        state: { const: "preparing" },
        preparationId: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "state"],
      properties: {
        operationId: { type: "string" },
        state: { enum: ["waiting-for-source", "queued", "building"] },
        indexedPracticeCount: { type: "integer" },
        totalPracticeCount: { type: "integer" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "state", "index"],
      properties: {
        operationId: { type: "string" },
        state: { const: "ready" },
        index: indexStatusResultSchema,
      },
    },
  ],
};

function toStatus(value: IndexStatus): JsonValue {
  return {
    state: value.state,
    profileId: value.profileId,
    ...("vectorCount" in value && value.vectorCount !== undefined
      ? { vectorCount: value.vectorCount }
      : {}),
    ...("operationId" in value ? { operationId: value.operationId } : {}),
    ...("indexedPracticeCount" in value && value.indexedPracticeCount !== undefined
      ? { indexedPracticeCount: value.indexedPracticeCount }
      : {}),
    ...("totalPracticeCount" in value && value.totalPracticeCount !== undefined
      ? { totalPracticeCount: value.totalPracticeCount }
      : {}),
  };
}

function toOperation(value: IndexOperation): JsonValue {
  if (value.state === "preparing") {
    return {
      operationId: value.operationId,
      state: value.state,
      preparationId: value.preparationId,
    };
  }
  if (
    value.state === "waiting-for-source" ||
    value.state === "queued" ||
    value.state === "building"
  ) {
    return {
      operationId: value.operationId,
      state: value.state,
      ...(value.indexedPracticeCount === undefined
        ? {}
        : { indexedPracticeCount: value.indexedPracticeCount }),
      ...(value.totalPracticeCount === undefined
        ? {}
        : { totalPracticeCount: value.totalPracticeCount }),
    };
  }
  if (value.state === "failed") {
    if (embeddingErrorCodes.includes(value.error as (typeof embeddingErrorCodes)[number])) {
      throw new EmbeddingError(value.error as (typeof embeddingErrorCodes)[number]);
    }
    if (
      indexOperationStoreErrorCodes.includes(
        value.error as (typeof indexOperationStoreErrorCodes)[number],
      )
    ) {
      throw storeCliError(value.error as (typeof indexOperationStoreErrorCodes)[number]);
    }
    throw new BackendError("backend.failed");
  }
  if (value.index === undefined) throw new BackendError("backend.failed");
  return { operationId: value.operationId, state: value.state, index: toStatus(value.index) };
}

function command(
  name: "status" | "build" | "rebuild" | "operation",
  summary: string,
  services: IndexCommandServices,
): CommandDefinition {
  const isStatus = name === "status";
  const isOperation = name === "operation";
  return {
    name: `index.${name}`,
    summary,
    positionals: isOperation ? [{ name: "operation-id", required: true }] : [],
    options: [],
    resultSchema: isStatus ? indexStatusResultSchema : indexOperationResultSchema,
    errorCodes: [
      ...frameworkErrorCodes,
      ...backendErrorCodes,
      ...embeddingErrorCodes,
      ...indexOperationStoreErrorCodes,
    ],
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const root = resolveInvocationStorageRoot(
          invocation.options.storeRoot,
          services.storageRoot,
        );
        const projectOptions = resolveProjectInvocationOptions(invocation.options);
        const project =
          isOperation || services.resolveProjectContext === undefined
            ? undefined
            : await services.resolveProjectContext(root, projectOptions);
        const indexOptions =
          project === undefined
            ? { cacheRoot: projectOptions.cacheRoot }
            : {
                projectContext: {
                  projectRoot: project.projectRootPath,
                  cacheRoot: projectOptions.cacheRoot,
                },
              };
        if (isStatus || isOperation) {
          const client = await services.createClient();
          if (isStatus)
            return {
              data: toStatus(await client.indexStatus(root, indexOptions)),
            };
          const operationId = invocation.positionals[0];
          if (operationId === undefined) throw new BackendError("backend.invalid-request");
          return { data: toOperation(await client.indexOperation(operationId)) };
        }
        const client = await services.createRuntimeClient();
        return {
          data: toOperation(
            name === "build"
              ? await client.build(root, indexOptions)
              : await client.rebuild(root, indexOptions),
          ),
        };
      } catch (error) {
        if (error instanceof BackendError || error instanceof EmbeddingError)
          throw new CliError(error.code, error.message);
        if (
          error instanceof BackendRemoteError &&
          indexOperationStoreErrorCodes.includes(
            error.code as (typeof indexOperationStoreErrorCodes)[number],
          )
        ) {
          throw storeCliError(error.code as (typeof indexOperationStoreErrorCodes)[number]);
        }
        if (error instanceof InvalidProjectRootError)
          throw new CliError("usage.invalid", error.message);
        throw error;
      }
    },
  };
}

function storeCliError(code: (typeof indexOperationStoreErrorCodes)[number]): CliError {
  return new CliError(
    code,
    code === "store.busy"
      ? "The local Pack store is busy."
      : "The local Pack store requires recovery.",
  );
}

export function createIndexCommands(services: IndexCommandServices): readonly CommandDefinition[] {
  return Object.freeze([
    command("status", "Report the selected Store's semantic index status.", services),
    command("build", "Build a semantic index for the selected Store.", services),
    command("rebuild", "Replace the selected Store's semantic index.", services),
    command("operation", "Report a semantic index operation.", services),
  ]);
}
