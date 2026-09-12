import type { BackendClient } from "@lorelum/backend/client";
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

import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { CliError, frameworkErrorCodes } from "../runtime/errors";
import { resolveInvocationStorageRoot } from "../store/storage-root";

export interface IndexCommandServices {
  readonly createClient: () => Promise<BackendClient>;
  readonly storageRoot: StorageRoot;
}

const indexStatusResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "profileId"],
  properties: {
    state: { enum: ["missing", "ready", "stale", "incompatible"] },
    profileId: { type: "string" },
    vectorCount: { type: "integer" },
  },
};

const indexBuildResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operationId", "state"],
  properties: {
    operationId: { type: "string" },
    state: { enum: ["ready"] },
    index: indexStatusResultSchema,
  },
};

function toStatus(value: IndexStatus): JsonValue {
  return {
    state: value.state,
    profileId: value.profileId,
    ...(value.vectorCount === undefined ? {} : { vectorCount: value.vectorCount }),
  };
}

function toOperation(value: IndexOperation): JsonValue {
  if (value.state === "failed") {
    if (
      value.error &&
      embeddingErrorCodes.includes(value.error as (typeof embeddingErrorCodes)[number])
    ) {
      throw new EmbeddingError(value.error as (typeof embeddingErrorCodes)[number]);
    }
    if (
      value.error &&
      indexOperationStoreErrorCodes.includes(
        value.error as (typeof indexOperationStoreErrorCodes)[number],
      )
    ) {
      throw storeCliError(value.error as (typeof indexOperationStoreErrorCodes)[number]);
    }
    throw new BackendError("backend.failed");
  }
  if (value.state !== "ready" || value.index === undefined)
    throw new BackendError("backend.failed");
  return { operationId: value.operationId, state: value.state, index: toStatus(value.index) };
}

async function waitForOperation(
  client: BackendClient,
  initial: IndexOperation,
): Promise<IndexOperation> {
  let current = initial;
  while (current.state === "building") {
    // eslint-disable-next-line no-await-in-loop -- operation polling must observe one terminal state in order.
    await Bun.sleep(100);
    // eslint-disable-next-line no-await-in-loop -- each poll depends on the previous operation state.
    current = await client.indexOperation(current.operationId);
  }
  return current;
}

function command(
  name: "status" | "build" | "rebuild",
  summary: string,
  services: IndexCommandServices,
): CommandDefinition {
  const isStatus = name === "status";
  return {
    name: `index.${name}`,
    summary,
    positionals: [],
    options: [],
    resultSchema: isStatus ? indexStatusResultSchema : indexBuildResultSchema,
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
        const client = await services.createClient();
        if (isStatus) return { data: toStatus(await client.indexStatus(root)) };
        const started =
          name === "build" ? await client.buildIndex(root) : await client.rebuildIndex(root);
        return { data: toOperation(await waitForOperation(client, started)) };
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
  ]);
}
