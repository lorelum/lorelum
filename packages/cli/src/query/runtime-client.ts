import {
  type BackendRuntimeCoordinator,
  type RuntimeWaitOptions,
} from "@lorelum/backend/coordination";
import type { BackendQueryRequest } from "@lorelum/backend/client";
import { EmbeddingError, type BackendQueryResult } from "@lorelum/backend/protocol";
import type { StorageRoot } from "@lorelum/engine";
import { createProcessBackendRuntimeCoordinator } from "../backend/process-runtime-coordinator";
import { createRuntimeProgressReporter } from "../backend/runtime-progress";
import type { OutputWriter } from "../output/protocol";
import type { TraceId } from "@lorelum/log";

export interface QueryPreparingResult {
  readonly state: "preparing";
  readonly preparationId: string;
  readonly message?: string;
}

export type SemanticRuntimeResult = BackendQueryResult | QueryPreparingResult;

export interface SemanticRuntimeClient {
  query(root: StorageRoot, request: BackendQueryRequest): Promise<SemanticRuntimeResult>;
}

export type SemanticRuntimeCoordinator = Pick<
  BackendRuntimeCoordinator,
  "connect" | "beginModelPreparation" | "observeModelPreparation"
>;

const DEFAULT_MODEL_PREPARATION_OBSERVATION_MS = 3_000;

/** CLI owns the transient query result; Backend owns the shared preparation lifetime. */
export function createSemanticRuntimeClient(
  coordinator: SemanticRuntimeCoordinator,
  writer: OutputWriter = process.stderr,
): SemanticRuntimeClient {
  const onProgress = createRuntimeProgressReporter(writer);
  return {
    async query(root: StorageRoot, request: BackendQueryRequest) {
      const wait: RuntimeWaitOptions = { onProgress };
      const client = await coordinator.connect(wait);
      try {
        return await client.query(root, { ...request, mode: "semantic" });
      } catch (error) {
        if (!(error instanceof EmbeddingError) || error.code !== "embedding.not-loaded")
          throw error;
      }

      const preparation = await coordinator.beginModelPreparation(client, wait);
      const observed = await coordinator.observeModelPreparation(
        client,
        preparation,
        wait,
        request.maxWaitMs ?? DEFAULT_MODEL_PREPARATION_OBSERVATION_MS,
      );
      if (observed.status.state === "ready") {
        return client.query(root, { ...request, mode: "semantic" });
      }
      if (observed.status.state === "loading") {
        return {
          state: "preparing",
          preparationId: observed.preparationId,
          message:
            "The local model is preparing in the background. Check lore model status, then retry this query.",
        } satisfies QueryPreparingResult;
      }
      throw new EmbeddingError(
        observed.status.error ?? "embedding.failed",
        undefined,
        observed.status.resource,
      );
    },
  } satisfies SemanticRuntimeClient;
}

export async function createProcessSemanticRuntimeClient(
  traceId?: TraceId,
  debug = false,
  writer: OutputWriter = process.stderr,
) {
  const coordinator = createProcessBackendRuntimeCoordinator(traceId, debug);
  return createSemanticRuntimeClient(coordinator, writer);
}
