import { randomUUID } from "node:crypto";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  type SemanticIndexService,
  type StorageRoot,
} from "@lorelum/engine";

import { BackendError } from "../../protocol/errors";
import { EmbeddingError } from "../embedding/errors";
import type { IndexOperation, IndexOperationErrorCode, IndexStatus } from "./model";

export interface IndexOperationService {
  status(root: StorageRoot): Promise<IndexStatus>;
  build(root: StorageRoot): IndexOperation;
  rebuild(root: StorageRoot): IndexOperation;
  operation(operationId: string): IndexOperation | undefined;
  waitForIdle(deadline?: number): Promise<void>;
}

function toIndexStatus(value: Awaited<ReturnType<SemanticIndexService["status"]>>): IndexStatus {
  return {
    state: value.state,
    profileId: value.profileId,
    ...(value.vectorCount === undefined ? {} : { vectorCount: value.vectorCount }),
  };
}

/** Owns daemon-lifetime index build state; Engine continues to own index contents and recovery. */
export function createIndexOperationService(index: SemanticIndexService): IndexOperationService {
  const byId = new Map<string, IndexOperation>();
  let activeOperationId: string | undefined;
  let activeTask: Promise<void> | undefined;

  const start = (root: StorageRoot, operation: "build" | "rebuild"): IndexOperation => {
    // The fixed v1 EmbeddingService admits one request; queueing would require a separate task contract.
    if (activeOperationId) throw new BackendError("backend.busy");
    const operationId = randomUUID();
    const initial: IndexOperation = Object.freeze({ operationId, state: "building" });
    byId.set(operationId, initial);
    activeOperationId = operationId;
    const task = Promise.resolve()
      .then(() => (operation === "build" ? index.build(root) : index.rebuild(root)))
      .then((result) => {
        byId.set(
          operationId,
          Object.freeze({ operationId, state: "ready", index: toIndexStatus(result.status) }),
        );
      })
      .catch((error: unknown) => {
        byId.set(
          operationId,
          Object.freeze({ operationId, state: "failed", error: operationFailure(error) }),
        );
      })
      .finally(() => {
        if (activeOperationId === operationId) activeOperationId = undefined;
        if (activeTask === task) activeTask = undefined;
      });
    activeTask = task;
    void task;
    return initial;
  };

  return Object.freeze({
    async status(root: StorageRoot) {
      return toIndexStatus(await index.status(root));
    },
    build: (root: StorageRoot) => start(root, "build"),
    rebuild: (root: StorageRoot) => start(root, "rebuild"),
    operation: (operationId: string) => byId.get(operationId),
    async waitForIdle(deadline?: number) {
      const task = activeTask;
      if (task === undefined) return;
      if (deadline === undefined) {
        await task;
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new BackendError("backend.deadline-exceeded");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new BackendError("backend.deadline-exceeded"));
        }, remaining);
        void task.then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    },
  });
}

function operationFailure(error: unknown): IndexOperationErrorCode {
  if (error instanceof EmbeddingError) return error.code;
  if (error instanceof StoreBusyError) return "store.busy";
  if (error instanceof StoreRecoveryRequiredError) return "store.recovery-required";
  if (error instanceof Error && "cause" in error && error.cause instanceof EmbeddingError) {
    return error.cause.code;
  }
  return "backend.failed";
}
