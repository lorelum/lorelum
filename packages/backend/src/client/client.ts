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
import { queryRequestSchema, queryResultSchema } from "../modules/query/model";
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
} from "../modules/embedding/dto";
import {
  indexMutationSchema,
  indexOperationParamsSchema,
  indexOperationSchema,
  indexStatusSchema,
  type IndexOperation,
  type IndexStatus,
} from "../modules/index/model";
import { ENCODING_ID } from "../modules/embedding/model";
import type { EmbeddingResult } from "../modules/embedding/model";
import { DEFAULT_BACKEND_SETTINGS } from "../config/model";
import type { QueryRequest, QueryResult, StorageRoot } from "@lorelum/engine";

export interface CreateBackendClientOptions {
  readonly identity: InstanceIdentity;
  readonly secret: string;
  /** Test-only alternate loopback HTTP address. */
  readonly baseUrl?: string;
  readonly buildIdentity: string;
  /** Timeout for ordinary control and embedding requests. */
  readonly timeoutMs?: number;
  /** Timeout budget for unloading the embedding model. */
  readonly shutdownTimeoutMs?: number;
}

export interface BackendClient {
  identity(): Promise<BackendIdentity>;
  status(): Promise<BackendStatus>;
  stop(): Promise<BackendStatus>;
  loadModel(options?: { onProgress?: (status: ModelStatus) => void }): Promise<ModelStatus>;
  statusModel(): Promise<ModelStatus>;
  unloadModel(): Promise<ModelStatus>;
  embed(kind: "query" | "document", inputs: readonly string[]): Promise<EmbeddingResult>;
  query(root: StorageRoot, request: QueryRequest): Promise<QueryResult>;
  indexStatus(root: StorageRoot): Promise<IndexStatus>;
  buildIndex(root: StorageRoot): Promise<IndexOperation>;
  rebuildIndex(root: StorageRoot): Promise<IndexOperation>;
  indexOperation(operationId: string): Promise<IndexOperation>;
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
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_BACKEND_SETTINGS.shutdownTimeoutMs;
  for (const timeout of [timeoutMs, shutdownTimeoutMs]) {
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
    const signal = AbortSignal.timeout(requestTimeoutMs);
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      proxy: "",
      signal,
      headers: { host: baseUrl.host, ...init.headers },
    }).catch((error: unknown) => {
      if (isTimeout(error)) {
        throw new BackendError("backend.deadline-exceeded", { cause: error });
      }
      throw new BackendError("backend.unavailable", { cause: error });
    });
    const body = await readBoundedJson(response, MAX_RESPONSE_BYTES).catch((error: unknown) => {
      throw new BackendError(signal.aborted ? "backend.deadline-exceeded" : "backend.failed", {
        cause: error,
      });
    });
    if (!response.ok) throw remoteError(body) ?? new BackendError("backend.failed");
    return body;
  };

  const identify = async (): Promise<BackendIdentity> => {
    const nonce = randomBytes(32).toString("hex");
    const body = await send(`${BACKEND_ROUTES.identity}?nonce=${nonce}`);
    const parsed = identitySchema.safeParse(body);
    if (!parsed.success) throw new BackendError("backend.port-conflict");
    const { proof, ...identity } = parsed.data;
    if (!constantTimeEqual(proof, identityProof(options.secret, nonce, identity))) {
      throw new BackendError("backend.port-conflict");
    }
    if (
      identity.instanceId !== options.identity.instanceId ||
      identity.buildIdentity !== options.identity.buildIdentity ||
      identity.buildIdentity !== options.buildIdentity ||
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
    }: {
      payload?: unknown;
      method?: "GET" | "POST";
      timeout?: number;
    } = {},
  ): Promise<T> => {
    await identify();
    const headers: Record<string, string> = { authorization: `Bearer ${options.secret}` };
    const init: RequestInit = { method, headers };
    if (payload !== undefined) {
      init.method = "POST";
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    const body = await send(path, init, timeout);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BackendError("backend.failed");
    return parsed.data;
  };

  const control = async (path: string, method: "GET" | "POST" = "GET"): Promise<BackendStatus> => {
    const result = await request(path, statusSchema, {
      method,
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

  return Object.freeze({
    identity: identify,
    status: () => control(BACKEND_ROUTES.status),
    stop: () => control(BACKEND_ROUTES.stop, "POST"),
    async loadModel({ onProgress } = {}) {
      let result = await modelRequest(BACKEND_ROUTES.modelLoad, { payload: {} });
      // Loading may include hours of useful transfer. Only each HTTP call has a deadline.
      while (result.state === "loading") {
        onProgress?.(result);
        await Bun.sleep(250);
        result = await modelRequest(BACKEND_ROUTES.modelStatus);
      }
      if (result.state === "failed") throw new EmbeddingError(result.error ?? "embedding.failed");
      if (result.state !== "ready") throw new EmbeddingError("embedding.not-loaded");
      return result;
    },
    statusModel: () => modelRequest(BACKEND_ROUTES.modelStatus),
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
    async query(root, query) {
      const payload = { storageRoot: root.rootPath, query };
      if (!queryRequestSchema.safeParse(payload).success)
        throw new BackendRemoteError("usage.invalid");
      return request(BACKEND_ROUTES.query, queryResultSchema, { payload });
    },
    async indexStatus(root) {
      const payload = { storageRoot: root.rootPath };
      if (!indexMutationSchema.safeParse(payload).success)
        throw new BackendError("backend.invalid-request");
      return request(
        `${BACKEND_ROUTES.indexStatus}?storageRoot=${encodeURIComponent(root.rootPath)}`,
        indexStatusSchema,
      );
    },
    async buildIndex(root) {
      const payload = { storageRoot: root.rootPath };
      if (!indexMutationSchema.safeParse(payload).success)
        throw new BackendError("backend.invalid-request");
      return request(BACKEND_ROUTES.indexBuild, indexOperationSchema, { payload });
    },
    async rebuildIndex(root) {
      const payload = { storageRoot: root.rootPath };
      if (!indexMutationSchema.safeParse(payload).success)
        throw new BackendError("backend.invalid-request");
      return request(BACKEND_ROUTES.indexRebuild, indexOperationSchema, { payload });
    },
    indexOperation(operationId) {
      if (!indexOperationParamsSchema.safeParse({ operationId }).success) {
        return Promise.reject(new BackendError("backend.invalid-request"));
      }
      return request(
        BACKEND_ROUTES.indexOperation.replace(":operationId", operationId),
        indexOperationSchema,
      );
    },
  } satisfies BackendClient);
}
