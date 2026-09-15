import {
  createBackendRuntimeCoordinator,
  type RuntimeWaitOptions,
} from "@lorelum/backend/coordination";
import type { BackendQueryRequest } from "@lorelum/backend/client";
import { EmbeddingError, type BackendQueryResult } from "@lorelum/backend/protocol";
import type { StorageRoot } from "@lorelum/engine";
import { createProcessBackendClient } from "../model/commands";
import { createProcessBackendSupervisor } from "../backend/control-commands";
import { createRuntimeProgressReporter } from "../backend/runtime-progress";
import type { OutputWriter } from "../output/protocol";

export interface QueryPreparingResult {
  readonly state: "preparing";
  readonly preparationId: string;
  readonly message?: string;
}

export type SemanticRuntimeResult = BackendQueryResult | QueryPreparingResult;

export interface SemanticRuntimeClient {
  query(root: StorageRoot, request: BackendQueryRequest): Promise<SemanticRuntimeResult>;
}

/** CLI owns the transient query result; Backend owns the shared preparation lifetime. */
export async function createProcessSemanticRuntimeClient(writer: OutputWriter = process.stderr) {
  const coordinator = createBackendRuntimeCoordinator({
    connect: createProcessBackendClient,
    start: async () => (await createProcessBackendSupervisor()).start(),
  });
  const onProgress = createRuntimeProgressReporter(writer);
  return {
    async query(root: StorageRoot, request: BackendQueryRequest) {
      const deadline = request.maxWaitMs === undefined ? undefined : Date.now() + request.maxWaitMs;
      const wait: RuntimeWaitOptions = {
        onProgress,
        ...(deadline === undefined ? {} : { deadline }),
      };
      const client = await coordinator.connect(wait);
      try {
        return await client.query(root, { ...request, mode: "semantic" }, { deadline });
      } catch (error) {
        if (!(error instanceof EmbeddingError) || error.code !== "embedding.not-loaded")
          throw error;
      }

      const preparation = await coordinator.beginModelPreparation(client, wait);
      const observed = await coordinator.observeModelPreparation(client, preparation, wait, 1_000);
      if (observed.status.state === "ready") {
        return client.query(root, { ...request, mode: "semantic" }, { deadline });
      }
      if (observed.status.state === "loading") {
        return {
          state: "preparing",
          preparationId: observed.preparationId,
          message:
            "The local model is preparing in the background. Check lore model status, then retry this query.",
        } satisfies QueryPreparingResult;
      }
      throw new EmbeddingError(observed.status.error ?? "embedding.failed");
    },
  } satisfies SemanticRuntimeClient;
}
