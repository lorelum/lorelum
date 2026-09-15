import type { IndexRuntimeClient } from "@lorelum/backend/coordination";
import {
  BackendError,
  BackendRemoteError,
  EmbeddingError,
  embeddingErrorCodes,
  indexOperationStoreErrorCodes,
  type IndexOperation,
  type IndexStatus,
} from "@lorelum/backend/protocol";
import type { StorageRoot } from "@lorelum/engine";

export type InstallIndexSync =
  | { readonly state: "ready"; readonly index: IndexStatus }
  | {
      readonly state: "pending";
      readonly operationId: string;
      readonly phase: "preparing" | "building";
    }
  | {
      readonly state: "failed";
      readonly error: { readonly code: string; readonly message: string };
    };

/** A Pack commit is canonical; a derived-index failure must be visible without rolling it back. */
export async function syncSemanticIndexAfterInstall(
  root: StorageRoot,
  client: IndexRuntimeClient,
): Promise<InstallIndexSync> {
  try {
    return fromOperation(await client.build(root));
  } catch (error) {
    return failed(error);
  }
}

export function failedInstallIndexSync(error: unknown): InstallIndexSync {
  return failed(error);
}

function fromOperation(operation: IndexOperation): InstallIndexSync {
  if (operation.state === "preparing")
    return {
      state: "pending",
      operationId: operation.operationId,
      phase: "preparing",
    };
  if (
    operation.state === "waiting-for-source" ||
    operation.state === "queued" ||
    operation.state === "building"
  )
    return { state: "pending", operationId: operation.operationId, phase: "building" };
  if (operation.state === "ready" && operation.index?.state === "ready")
    return { state: "ready", index: operation.index };
  if (operation.state === "failed") {
    if (
      operation.error !== undefined &&
      embeddingErrorCodes.includes(operation.error as (typeof embeddingErrorCodes)[number])
    ) {
      return failed(new EmbeddingError(operation.error as (typeof embeddingErrorCodes)[number]));
    }
    if (
      operation.error !== undefined &&
      indexOperationStoreErrorCodes.includes(
        operation.error as (typeof indexOperationStoreErrorCodes)[number],
      )
    ) {
      return failedStore(operation.error as (typeof indexOperationStoreErrorCodes)[number]);
    }
  }
  return failed(new BackendError("backend.failed"));
}

function failed(error: unknown): InstallIndexSync {
  if (error instanceof EmbeddingError || error instanceof BackendError)
    return failure(error.code, error.message);
  if (
    error instanceof BackendRemoteError &&
    indexOperationStoreErrorCodes.includes(
      error.code as (typeof indexOperationStoreErrorCodes)[number],
    )
  ) {
    return failedStore(error.code as (typeof indexOperationStoreErrorCodes)[number]);
  }
  return failure(
    "backend.failed",
    "The semantic index could not be synchronized. Run `lore index build` for this Store.",
  );
}

function failedStore(code: (typeof indexOperationStoreErrorCodes)[number]): InstallIndexSync {
  return failure(
    code,
    code === "store.busy"
      ? "The local Pack store is busy."
      : "The local Pack store requires recovery.",
  );
}

function failure(code: string, message: string): InstallIndexSync {
  return {
    state: "failed",
    error: {
      code,
      message: `Pack installed, but semantic index sync failed. ${message}`,
    },
  };
}
