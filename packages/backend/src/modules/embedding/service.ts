/* eslint-disable no-await-in-loop -- Native single-slot encoding is intentionally sequential. */
import { waitForSettlement } from "../../lifecycle/deadline";
import type { BackendSettings } from "../../config/model";
import { embeddingRequestSchema, type ModelStatus } from "./dto";
import { EmbeddingError, embeddingFailure, type EmbeddingErrorCode } from "./errors";
import {
  EMBEDDING_MODEL,
  ENCODING_ID,
  type EmbeddingRuntime,
  type EmbeddingResult,
  type ModelState,
} from "./model";

const SHUTDOWN_DRAIN_RESERVE_MS = 200;

export interface EmbeddingServiceOptions {
  readonly createRuntime: () => EmbeddingRuntime;
  readonly settings: BackendSettings;
}
export function createEmbeddingService(options: EmbeddingServiceOptions) {
  let state: ModelState = "unloaded";
  let failure: EmbeddingErrorCode | undefined;
  let runtime: EmbeddingRuntime | undefined;
  let loading: Promise<ModelStatus> | undefined;
  let unloading: Promise<ModelStatus> | undefined;
  let inflight: Promise<EmbeddingResult> | undefined;
  let startup: AbortController | undefined;
  let unloadDeadline: number | undefined;
  const status = (): ModelStatus => ({
    state,
    encodingId: ENCODING_ID,
    device: "cpu",
    dimensions: EMBEDDING_MODEL.dimensions,
    ...(failure ? { error: failure } : {}),
  });
  async function recycle(handle: EmbeddingRuntime, deadline: number) {
    await handle.stop(deadline);
    if (runtime === handle) runtime = undefined;
  }
  async function recover(error: EmbeddingError, handle?: EmbeddingRuntime): Promise<never> {
    if (state !== "unloading") {
      state = "failed";
      failure = error.code;
    }
    if (handle) {
      try {
        await recycle(handle, unloadDeadline ?? Date.now() + options.settings.shutdownTimeoutMs);
      } catch (cleanupError) {
        // Keep the public operation error stable and retain ownership for a later cleanup retry.
        throw new EmbeddingError(error.code, { cause: new AggregateError([error, cleanupError]) });
      }
    }
    throw error;
  }
  function load(): Promise<ModelStatus> {
    if (state === "unloading") return Promise.reject(new EmbeddingError("embedding.busy"));
    if (loading) return loading;
    if (state === "ready") return Promise.resolve(status());
    if (runtime || inflight) return Promise.reject(new EmbeddingError("embedding.busy"));
    state = "loading";
    failure = undefined;
    startup = new AbortController();
    const signal = startup.signal;
    loading = Promise.resolve().then(async () => {
      let handle: EmbeddingRuntime | undefined;
      try {
        signal.throwIfAborted();
        handle = options.createRuntime();
        runtime = handle;
        await handle.start(signal, Date.now() + options.settings.startupTimeoutMs);
        signal.throwIfAborted();
        if (state !== "loading") throw new EmbeddingError("embedding.busy");
        state = "ready";
        const active = handle;
        void handle.exited.then(() => {
          if (runtime === active && state === "ready") {
            state = "failed";
            failure = "embedding.failed";
            runtime = undefined;
          }
        });
        return status();
      } catch (error) {
        return await recover(embeddingFailure(error), handle);
      } finally {
        loading = undefined;
      }
    });
    return loading;
  }
  function unload(
    deadline = Date.now() + options.settings.shutdownTimeoutMs,
  ): Promise<ModelStatus> {
    if (unloading) return unloading;
    state = "unloading";
    unloadDeadline = deadline;
    startup?.abort();
    unloading = Promise.resolve().then(async () => {
      try {
        // A submitted native request must finish or its owned process must exit.
        if (inflight) await waitForSettlement(inflight, deadline - SHUTDOWN_DRAIN_RESERVE_MS);
        const handle = runtime;
        if (handle) await recycle(handle, deadline);
        if (loading && !(await waitForSettlement(loading, deadline)))
          throw new EmbeddingError("embedding.deadline-exceeded");
        if (inflight && !(await waitForSettlement(inflight, deadline)))
          throw new EmbeddingError("embedding.deadline-exceeded");
        if (runtime) throw new EmbeddingError("embedding.deadline-exceeded");
        state = "unloaded";
        failure = undefined;
        return status();
      } catch (error) {
        state = "failed";
        failure = embeddingFailure(error).code;
        throw embeddingFailure(error);
      } finally {
        unloading = undefined;
        unloadDeadline = undefined;
      }
    });
    return unloading;
  }
  async function embed(kind: "query" | "document", inputs: readonly string[]) {
    if (!embeddingRequestSchema.safeParse({ kind, inputs }).success)
      throw new EmbeddingError("embedding.input-invalid");
    if (state === "loading" || state === "unloading" || inflight)
      throw new EmbeddingError("embedding.busy");
    if (state !== "ready" || !runtime) throw new EmbeddingError("embedding.not-loaded");
    const handle = runtime;
    const signal = AbortSignal.timeout(options.settings.requestTimeoutMs);
    const work = async () => {
      try {
        for (const text of inputs) {
          if ((await handle.tokenize(text, signal)).length > EMBEDDING_MODEL.maxTokens)
            throw new EmbeddingError("embedding.input-too-long");
        }
        const vectors: number[][] = [];
        for (const text of inputs) vectors.push(await handle.encode(text, signal));
        signal.throwIfAborted();
        if (runtime !== handle) throw new EmbeddingError("embedding.not-loaded");
        return { encodingId: ENCODING_ID, vectors };
      } catch (error) {
        const visible = signal.aborted
          ? new EmbeddingError("embedding.deadline-exceeded")
          : embeddingFailure(error);
        if (visible.code === "embedding.input-too-long") throw visible;
        return recover(visible, handle);
      }
    };
    inflight = work();
    try {
      return await inflight;
    } finally {
      inflight = undefined;
    }
  }
  return { status, load, unload, embed };
}
export type EmbeddingService = ReturnType<typeof createEmbeddingService>;
