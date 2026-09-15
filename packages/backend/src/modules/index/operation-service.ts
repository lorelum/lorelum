import { randomUUID } from "node:crypto";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  type SemanticIndexService,
  type StorageRoot,
} from "@lorelum/engine";

import { BackendError } from "../../protocol/errors";
import { EmbeddingError } from "../embedding/errors";
import type { ModelPreparation, ModelStatus } from "../embedding/dto";
import type { EmbeddingErrorCode } from "../embedding/errors";
import type { IndexOperation, IndexOperationErrorCode, IndexStatus } from "./model";

export interface IndexOperationService {
  status(root: StorageRoot): Promise<IndexStatus>;
  build(root: StorageRoot): IndexOperation;
  rebuild(root: StorageRoot): IndexOperation;
  operation(operationId: string): IndexOperation | undefined;
  waitForIdle(deadline?: number): Promise<void>;
}

/** Narrow daemon-side adapter for sharing the embedding preparation task. */
export interface IndexModelPreparationService {
  beginModelPreparation(): ModelPreparation;
  waitModelPreparation(preparationId: string): Promise<ModelStatus>;
}

function toIndexStatus(value: Awaited<ReturnType<SemanticIndexService["status"]>>): IndexStatus {
  return {
    state: value.state,
    profileId: value.profileId,
    ...(value.vectorCount === undefined ? {} : { vectorCount: value.vectorCount }),
  };
}

/** Owns daemon-lifetime index build state; Engine continues to own index contents and recovery. */
export function createIndexOperationService(
  index: SemanticIndexService,
  modelPreparation?: IndexModelPreparationService,
): IndexOperationService {
  const byId = new Map<string, IndexOperation>();
  let activeOperationId: string | undefined;
  let activeTask: Promise<void> | undefined;

  const start = (root: StorageRoot, operation: "build" | "rebuild"): IndexOperation => {
    // The fixed v1 EmbeddingService admits one request. Joining its active work is a
    // safe default for first-query callers and avoids making them retry a recoverable state.
    if (activeOperationId) {
      const active = byId.get(activeOperationId);
      if (active !== undefined) return active;
    }
    const operationId = randomUUID();
    const initial: IndexOperation = Object.freeze({ operationId, state: "building" });
    byId.set(operationId, initial);
    activeOperationId = operationId;
    const runEngine = () => (operation === "build" ? index.build(root) : index.rebuild(root));
    const task = Promise.resolve()
      .then(async () => {
        try {
          return await runEngine();
        } catch (error) {
          if (modelPreparation === undefined || embeddingCode(error) !== "embedding.not-loaded") {
            throw error;
          }

          // Engine has already released its staging and mutation lock when build rejects. Keep
          // the same operation alive while the daemon shares the model preparation task.
          const preparation = modelPreparation.beginModelPreparation();
          byId.set(
            operationId,
            Object.freeze({
              operationId,
              state: "preparing",
              preparationId: preparation.preparationId,
            }),
          );
          await modelPreparation.waitModelPreparation(preparation.preparationId);
          // Re-enter Engine after preparation so it observes a fresh Store snapshot.
          return await runEngine();
        }
      })
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
  const embeddingError = embeddingCode(error);
  if (embeddingError !== undefined) return embeddingError;
  if (error instanceof StoreBusyError) return "store.busy";
  if (error instanceof StoreRecoveryRequiredError) return "store.recovery-required";
  return "backend.failed";
}

function embeddingCode(error: unknown): EmbeddingErrorCode | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current instanceof EmbeddingError) return current.code;
    if (!(current instanceof Error) || !("cause" in current)) return undefined;
    current = current.cause;
  }
  return undefined;
}
