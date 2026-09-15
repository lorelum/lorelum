/* eslint-disable no-await-in-loop -- Model loading polls one shared operation without a transfer deadline. */
import type { z } from "zod";
import { readBoundedJson } from "../http/read-json";
import { randomBytes } from "node:crypto";

import {
  BACKEND_URL,
  BACKEND_ROUTES,
  PROTOCOL_VERSION,
  MAX_RESPONSE_BYTES,
} from "../protocol/constants";
import {
  errorSchema,
  BackendRemoteError,
  backendRemoteErrorCodes,
  BackendError,
  backendErrorCodes,
} from "../protocol/errors";
import { EmbeddingError, embeddingErrorCodes } from "../modules/embedding/errors";
import { constantTimeEqual, identityProof, type InstanceIdentity } from "../protocol/identity";
import {
  queryRequestSchema,
  queryResultSchema,
  type BackendQueryResult,
  type ProjectSemanticRequest,
  type QueryMode,
} from "../modules/query/model";
import {
  identitySchema,
  statusSchema,
  type BackendIdentity,
  type BackendStatus,
} from "../modules/backend/model";
import {
  embeddingRequestSchema,
  embeddingResultSchema,
  modelStatusSchema,
  type ModelStatus,
  modelPreparationSchema,
  modelPreparationParamsSchema,
  type ModelPreparation,
} from "../modules/embedding/dto";
import {
  indexMutationSchema,
  indexOperationParamsSchema,
  indexOperationSchema,
  indexStatusQuerySchema,
  indexStatusSchema,
  type IndexOperation,
  type IndexStatus,
  type ProjectIndexRequest,
} from "../modules/index/model";
import { ENCODING_ID } from "../modules/embedding/model";
import type { EmbeddingResult } from "../modules/embedding/model";
import { DEFAULT_BACKEND_SETTINGS } from "../config/model";
import type { QueryRequest, StorageRoot } from "@lorelum/engine";

export type BackendQueryRequest = QueryRequest & {
  readonly mode?: QueryMode;
  readonly projectContext?: ProjectSemanticRequest;
  readonly cacheRoot?: string;
  readonly maxWaitMs?: number;
  readonly minCoveragePercent?: number;
};
export interface BackendRequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly deadline?: number | undefined;
}

export interface BackendIndexRequestOptions extends BackendRequestOptions {
  readonly projectContext?: ProjectIndexRequest;
  readonly cacheRoot?: string;
}

export interface CreateBackendClientOptions {
  readonly identity: InstanceIdentity;
  readonly secret: string;
  /** Test-only alternate loopback HTTP address. */
  readonly baseUrl?: string;
  readonly buildIdentity: string;
  /** Timeout for ordinary control and embedding requests. */
  readonly timeoutMs?: number;
  /** Timeout budget for local file verification and native model startup. */
  readonly startupTimeoutMs?: number;
  /** Timeout budget for unloading the embedding model. */
  readonly shutdownTimeoutMs?: number;
}

export interface BackendClient {
  identity(options?: BackendRequestOptions): Promise<BackendIdentity>;
  status(): Promise<BackendStatus>;
  stop(): Promise<BackendStatus>;
  loadModel(options?: { onProgress?: (status: ModelStatus) => void }): Promise<ModelStatus>;
  statusModel(): Promise<ModelStatus>;
  beginModelPreparation(options?: BackendRequestOptions): Promise<ModelPreparation>;
  modelPreparation(
    preparationId: string,
    options?: BackendRequestOptions,
  ): Promise<ModelPreparation>;
  unloadModel(): Promise<ModelStatus>;
  embed(kind: "query" | "document", inputs: readonly string[]): Promise<EmbeddingResult>;
  query(
    root: StorageRoot,
    request: BackendQueryRequest,
    options?: BackendRequestOptions,
  ): Promise<BackendQueryResult>;
  indexStatus(root: StorageRoot, options?: BackendIndexRequestOptions): Promise<IndexStatus>;
  buildIndex(root: StorageRoot, options?: BackendIndexRequestOptions): Promise<IndexOperation>;
  rebuildIndex(root: StorageRoot, options?: BackendIndexRequestOptions): Promise<IndexOperation>;
  indexOperation(operationId: string, options?: BackendRequestOptions): Promise<IndexOperation>;
}

function validatedLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username !== "" || url.password !== "") {
    throw new TypeError("Backend URL must be an unauthenticated HTTP loopback URL");
  }
  if (url.hostname !== "127.0.0.1") {
    throw new TypeError("Backend URL must use a loopback host");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new TypeError("Backend URL must not include a path, query, or fragment");
  }
  return url;
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError"
  );
}

function remoteError(body: unknown): Error | undefined {
  const parsed = errorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  if ((backendErrorCodes as readonly string[]).includes(parsed.data.error.code)) {
    return new BackendError(parsed.data.error.code as (typeof backendErrorCodes)[number]);
  }
  if ((backendRemoteErrorCodes as readonly string[]).includes(parsed.data.error.code)) {
    return new BackendRemoteError(
      parsed.data.error.code as (typeof backendRemoteErrorCodes)[number],
    );
  }
  if ((embeddingErrorCodes as readonly string[]).includes(parsed.data.error.code)) {
    return new EmbeddingError(parsed.data.error.code as (typeof embeddingErrorCodes)[number]);
  }
  return new BackendError("backend.failed");
}

/** A fetch-only client boundary; it has no runtime dependency on Engine or Elysia. */
export function createBackendClient(options: CreateBackendClientOptions): BackendClient {
  if (options.secret.length === 0) throw new TypeError("Backend secret must not be empty");
  if (options.buildIdentity.length === 0) throw new TypeError("Build identity must not be empty");
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKEND_SETTINGS.requestTimeoutMs;
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_BACKEND_SETTINGS.startupTimeoutMs;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_BACKEND_SETTINGS.shutdownTimeoutMs;
  for (const timeout of [timeoutMs, startupTimeoutMs, shutdownTimeoutMs]) {
    if (!Number.isInteger(timeout) || timeout < 1)
      throw new TypeError("Timeout must be a positive integer");
  }
  let expectedEncodingId: string | undefined;
  const baseUrl = validatedLoopbackUrl(options.baseUrl ?? BACKEND_URL);

  const send = async (
    path: string,
    init: RequestInit = {},
    requestTimeoutMs = timeoutMs,
  ): Promise<unknown> => {
    const url = new URL(path, baseUrl);
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const signal = init.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      proxy: "",
      signal,
      headers: { host: baseUrl.host, ...init.headers },
    }).catch((error: unknown) => {
      if (init.signal?.aborted) throw init.signal.reason;
      if (isTimeout(error)) {
        throw new BackendError("backend.deadline-exceeded", { cause: error });
      }
      throw new BackendError("backend.unavailable", { cause: error });
    });
    const body = await readBoundedJson(response, MAX_RESPONSE_BYTES).catch((error: unknown) => {
      if (init.signal?.aborted) throw init.signal.reason;
      throw new BackendError(
        timeoutSignal.aborted ? "backend.deadline-exceeded" : "backend.failed",
        {
          cause: error,
        },
      );
    });
    if (!response.ok) throw remoteError(body) ?? new BackendError("backend.failed");
    return body;
  };

  const identify = async (
    requestOptions: BackendRequestOptions = {},
    allowCurrentBuildMismatch = false,
  ): Promise<BackendIdentity> => {
    const nonce = randomBytes(32).toString("hex");
    const body = await send(
      `${BACKEND_ROUTES.identity}?nonce=${nonce}`,
      { signal: requestOptions.signal ?? null },
      remaining(requestOptions),
    );
    const parsed = identitySchema.safeParse(body);
    if (!parsed.success) throw new BackendError("backend.port-conflict");
    const { proof, ...identity } = parsed.data;
    if (!constantTimeEqual(proof, identityProof(options.secret, nonce, identity))) {
      throw new BackendError("backend.port-conflict");
    }
    if (
      identity.instanceId !== options.identity.instanceId ||
      identity.buildIdentity !== options.identity.buildIdentity ||
      (!allowCurrentBuildMismatch && identity.buildIdentity !== options.buildIdentity) ||
      identity.protocolVersion !== PROTOCOL_VERSION
    ) {
      throw new BackendError("backend.incompatible");
    }
    return parsed.data;
  };

  // One authenticated JSON request path; endpoint methods only supply their contract.
  const request = async <T>(
    path: string,
    schema: z.ZodType<T>,
    {
      payload,
      method = "GET",
      timeout = timeoutMs,
      signal,
      deadline,
      allowCurrentBuildMismatch = false,
    }: {
      payload?: unknown;
      method?: "GET" | "POST";
      timeout?: number;
      signal?: AbortSignal | undefined;
      deadline?: number | undefined;
      allowCurrentBuildMismatch?: boolean;
    } = {},
  ): Promise<T> => {
    const budget = { signal, deadline: deadline ?? Date.now() + timeout };
    await identify(budget, allowCurrentBuildMismatch);
    const headers: Record<string, string> = { authorization: `Bearer ${options.secret}` };
    const init: RequestInit = { method, headers, signal: signal ?? null };
    if (payload !== undefined) {
      init.method = "POST";
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    const body = await send(path, init, remaining(budget, timeout));
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BackendError("backend.failed");
    return parsed.data;
  };
  function remaining(requestOptions: BackendRequestOptions, upper = timeoutMs) {
    requestOptions.signal?.throwIfAborted();
    const value = Math.min(upper, (requestOptions.deadline ?? Date.now() + upper) - Date.now());
    if (value < 1) throw new BackendError("backend.deadline-exceeded");
    return Math.max(1, Math.ceil(value));
  }

  const control = async (
    path: string,
    method: "GET" | "POST" = "GET",
    allowCurrentBuildMismatch = false,
  ): Promise<BackendStatus> => {
    const result = await request(path, statusSchema, {
      method,
      allowCurrentBuildMismatch,
    });
    if (
      result.instanceId !== options.identity.instanceId ||
      result.buildIdentity !== options.identity.buildIdentity
    )
      throw new BackendError("backend.failed");
    return result;
  };

  async function modelRequest(
    path: string,
    requestOptions: { payload?: unknown; timeout?: number } = {},
  ) {
    const result = await request(path, modelStatusSchema, requestOptions);
    if (result.encodingId !== ENCODING_ID) throw new BackendError("backend.incompatible");
    expectedEncodingId = result.encodingId;
    return result;
  }
  async function preparationRequest(
    path: string,
    requestOptions: BackendRequestOptions & { payload?: unknown } = {},
  ) {
    const result = await request(path, modelPreparationSchema, requestOptions);
    if (result.status.encodingId !== ENCODING_ID) throw new BackendError("backend.incompatible");
    expectedEncodingId = result.status.encodingId;
    return result;
  }

  return Object.freeze({
    identity: identify,
    status: () => control(BACKEND_ROUTES.status),
    stop: () => control(BACKEND_ROUTES.stop, "POST", true),
    async loadModel({ onProgress } = {}) {
      let result = await modelRequest(BACKEND_ROUTES.modelLoad, { payload: {} });
      // Explicit load admits retries; automatic admission only joins/starts a nonfailed task.
      const preparation =
        result.state === "loading"
          ? await preparationRequest(BACKEND_ROUTES.modelPrepare, { payload: {} })
          : undefined;
      if (preparation) result = preparation.status;
      // Loading may include hours of useful transfer. Only each HTTP call has a deadline.
      while (result.state === "loading") {
        onProgress?.(result);
        await Bun.sleep(250);
        if (!preparation) throw new BackendError("backend.failed");
        const observed = await preparationRequest(
          BACKEND_ROUTES.modelPreparation.replace(":preparationId", preparation.preparationId),
        );
        if (observed.preparationId !== preparation.preparationId)
          throw new EmbeddingError("embedding.preparation-expired");
        result = observed.status;
      }
      if (result.state === "failed") throw new EmbeddingError(result.error ?? "embedding.failed");
      if (result.state !== "ready") throw new EmbeddingError("embedding.not-loaded");
      return result;
    },
    statusModel: () => modelRequest(BACKEND_ROUTES.modelStatus),
    beginModelPreparation: (requestOptions) =>
      preparationRequest(BACKEND_ROUTES.modelPrepare, { payload: {}, ...requestOptions }),
    async modelPreparation(preparationId, requestOptions) {
      if (!modelPreparationParamsSchema.safeParse({ preparationId }).success)
        throw new BackendError("backend.invalid-request");
      const result = await preparationRequest(
        BACKEND_ROUTES.modelPreparation.replace(":preparationId", preparationId),
        requestOptions,
      );
      if (result.preparationId !== preparationId)
        throw new EmbeddingError("embedding.preparation-expired");
      return result;
    },
    unloadModel: () =>
      modelRequest(BACKEND_ROUTES.modelUnload, { payload: {}, timeout: shutdownTimeoutMs }),
    async embed(kind, inputs) {
      const payload = { kind, inputs };
      if (!embeddingRequestSchema.safeParse(payload).success)
        throw new EmbeddingError("embedding.input-invalid");
      if (!expectedEncodingId) await modelRequest(BACKEND_ROUTES.modelStatus);
      const result = await request(BACKEND_ROUTES.embeddings, embeddingResultSchema, { payload });
      if (result.vectors.length !== inputs.length || result.encodingId !== expectedEncodingId)
        throw new BackendError("backend.failed");
      return result;
    },
    async query(root, query, requestOptions) {
      const payload = { storageRoot: root.rootPath, query };
      if (!queryRequestSchema.safeParse(payload).success)
        throw new BackendRemoteError("usage.invalid");
      return request(BACKEND_ROUTES.query, queryResultSchema, { payload, ...requestOptions });
    },
    async indexStatus(root, requestOptions) {
      const payload = {
        storageRoot: root.rootPath,
        ...(requestOptions?.projectContext !== undefined
          ? {
              projectRoot: requestOptions.projectContext.projectRoot,
              cacheRoot: requestOptions.projectContext.cacheRoot,
            }
          : requestOptions?.cacheRoot === undefined
            ? {}
            : { cacheRoot: requestOptions.cacheRoot }),
      };
      if (!indexStatusQuerySchema.safeParse(payload).success)
        throw new BackendError("backend.invalid-request");
      const search = new URLSearchParams({ storageRoot: root.rootPath });
      if (requestOptions?.projectContext !== undefined) {
        search.set("projectRoot", requestOptions.projectContext.projectRoot);
        search.set("cacheRoot", requestOptions.projectContext.cacheRoot);
      } else if (requestOptions?.cacheRoot !== undefined) {
        search.set("cacheRoot", requestOptions.cacheRoot);
      }
      return request(
        `${BACKEND_ROUTES.indexStatus}?${search.toString()}`,
        indexStatusSchema,
        requestOptions,
      );
    },
    async buildIndex(root, requestOptions) {
      const payload = {
        storageRoot: root.rootPath,
        ...(requestOptions?.projectContext !== undefined
          ? { projectContext: requestOptions.projectContext }
          : requestOptions?.cacheRoot === undefined
            ? {}
            : { cacheRoot: requestOptions.cacheRoot }),
      };
      if (!indexMutationSchema.safeParse(payload).success)
        throw new BackendError("backend.invalid-request");
      return request(BACKEND_ROUTES.indexBuild, indexOperationSchema, {
        payload,
        ...requestOptions,
      });
    },
    async rebuildIndex(root, requestOptions) {
      const payload = {
        storageRoot: root.rootPath,
        ...(requestOptions?.projectContext !== undefined
          ? { projectContext: requestOptions.projectContext }
          : requestOptions?.cacheRoot === undefined
            ? {}
            : { cacheRoot: requestOptions.cacheRoot }),
      };
      if (!indexMutationSchema.safeParse(payload).success)
        throw new BackendError("backend.invalid-request");
      return request(BACKEND_ROUTES.indexRebuild, indexOperationSchema, {
        payload,
        ...requestOptions,
      });
    },
    indexOperation(operationId, requestOptions) {
      if (!indexOperationParamsSchema.safeParse({ operationId }).success) {
        return Promise.reject(new BackendError("backend.invalid-request"));
      }
      return request(
        BACKEND_ROUTES.indexOperation.replace(":operationId", operationId),
        indexOperationSchema,
        requestOptions,
      );
    },
  } satisfies BackendClient);
}
