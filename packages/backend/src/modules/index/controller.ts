import { BACKEND_ROUTES } from "../../protocol/constants";
import {
  BackendError,
  BackendRemoteError,
  backendErrorBody,
  errorSchema,
} from "../../protocol/errors";
import { resolveRequestedRetrievalMethod } from "../../protocol/retrieval-method";
import { Elysia, status } from "elysia";
import { randomUUID } from "node:crypto";
import {
  requireJson,
  reject,
  requestDiagnosticLevel,
  requestTraceId,
} from "../../plugins/local-auth";
import { noopEmitter, withDiagnosticLevel, type LogEmitter, type TraceId } from "@lorelum/log";
import { EmbeddingError } from "../embedding/errors";
import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  defaultQueryArtifactCacheRoot,
} from "@lorelum/engine";
import {
  indexMutationSchema,
  indexOperationParamsSchema,
  indexOperationSchema,
  indexStatusQuerySchema,
  indexStatusSchema,
  type IndexOperation,
} from "./model";
import type {
  ContentAddressedSemanticRuntimePort,
  ContentAddressedTargetRequest,
} from "../query/content-addressed-semantic-runtime";

/** HTTP/authentication adapter for a Backend-hosted Engine semantic index service. */
export function indexController(
  runtime: ContentAddressedSemanticRuntimePort,
  available: () => boolean,
  diagnostics: LogEmitter = noopEmitter,
) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      if (request.method === "POST") return requireJson(request);
    })
    .get(
      BACKEND_ROUTES.indexStatus,
      async ({ query }) => {
        try {
          return await runtime.indexStatus({ rootPath: query.storageRoot }, targetForStatus(query));
        } catch (error) {
          return indexFailure(error);
        }
      },
      {
        query: indexStatusQuerySchema,
        response: { 200: indexStatusSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .post(
      BACKEND_ROUTES.indexBuild,
      ({ body, request }) => handleIndexMutation(runtime, "build", diagnostics, body, request),
      {
        body: indexMutationSchema,
        response: { 202: indexOperationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .post(
      BACKEND_ROUTES.indexRebuild,
      ({ body, request }) => handleIndexMutation(runtime, "rebuild", diagnostics, body, request),
      {
        body: indexMutationSchema,
        response: { 202: indexOperationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .get(
      BACKEND_ROUTES.indexOperation,
      async ({ params }) => {
        const operation = await runtime.indexOperation(params.operationId);
        return operation === undefined
          ? status(410, backendErrorBody("backend.operation-expired"))
          : operation;
      },
      {
        params: indexOperationParamsSchema,
        response: { 200: indexOperationSchema, 400: errorSchema, 410: errorSchema },
      },
    );
}

type IndexMutationMethod = "build" | "rebuild";
type IndexMutationBody = Parameters<typeof targetForMutation>[0] & {
  readonly storageRoot: string;
};

async function handleIndexMutation(
  runtime: ContentAddressedSemanticRuntimePort,
  mutation: IndexMutationMethod,
  diagnostics: LogEmitter,
  body: IndexMutationBody,
  request: Request,
) {
  const traceId = requestTraceId(request);
  const requestDiagnostics = withDiagnosticLevel(diagnostics, requestDiagnosticLevel(request));
  const requestId = randomUUID();
  const startedAt = Date.now();
  if (traceId !== undefined) {
    requestDiagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "backend",
      event: "backend.request.started",
      traceId,
      requestId,
      route: "index",
      method: "POST",
    });
    requestDiagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "backend",
      event: "trace.request.accepted",
      traceId,
      requestId,
    });
  }
  try {
    const operation = await runtime[mutation](
      { rootPath: body.storageRoot },
      targetForMutation(body),
    );
    if (traceId !== undefined) {
      recordIndexMutationAccepted(requestDiagnostics, traceId, requestId, operation, startedAt);
    }
    return status(202, operation);
  } catch (error) {
    if (traceId !== undefined) {
      requestDiagnostics.emit({
        time: new Date().toISOString(),
        level: "error",
        component: "backend",
        event: "backend.request.failed",
        traceId,
        requestId,
        route: "index",
        method: "POST",
        status: 503,
        durationMs: Date.now() - startedAt,
        code: publicErrorCode(error),
      });
    }
    return indexFailure(error);
  }
}

function recordIndexMutationAccepted(
  diagnostics: LogEmitter,
  traceId: TraceId,
  requestId: string,
  operation: IndexOperation,
  startedAt: number,
): void {
  const preparation =
    operation.state === "preparing" ? { preparationId: operation.preparationId } : {};
  diagnostics.emit({
    time: new Date().toISOString(),
    level: "info",
    component: "backend",
    event: "trace.operation.accepted",
    traceId,
    requestId,
    operationId: operation.operationId,
    ...preparation,
  });
  if (operation.state === "preparing") {
    diagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "backend",
      event: "trace.preparation.accepted",
      traceId,
      requestId,
      preparationId: operation.preparationId,
    });
  }
  diagnostics.emit({
    time: new Date().toISOString(),
    level: "info",
    component: "backend",
    event: "backend.request.completed",
    traceId,
    requestId,
    route: "index",
    method: "POST",
    status: 202,
    operationId: operation.operationId,
    ...preparation,
    durationMs: Date.now() - startedAt,
  });
}

function publicErrorCode(error: unknown): string {
  if (error instanceof BackendRemoteError) return error.code;
  if (error instanceof EmbeddingError) return error.code;
  if (error instanceof BackendError) return error.code;
  if (error instanceof StoreBusyError) return "store.busy";
  if (error instanceof StoreRecoveryRequiredError) return "store.recovery-required";
  return "backend.failed";
}

function targetForStatus(input: {
  readonly retrievalMethod?: unknown;
  readonly cacheRoot?: string | undefined;
  readonly projectRoot?: string | undefined;
  readonly projectStartDirectory?: string | undefined;
}): ContentAddressedTargetRequest {
  const retrievalMethod = resolveRequestedRetrievalMethod(input.retrievalMethod);
  const cacheRoot = input.cacheRoot ?? defaultQueryArtifactCacheRoot();
  if (input.projectRoot !== undefined || input.projectStartDirectory !== undefined) {
    return Object.freeze({
      kind: "project",
      retrievalMethod,
      cacheRoot,
      ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
      ...(input.projectStartDirectory === undefined
        ? {}
        : { startDirectory: input.projectStartDirectory }),
    });
  }
  return Object.freeze({ kind: "store", cacheRoot, retrievalMethod });
}

function targetForMutation(input: {
  readonly retrievalMethod?: unknown;
  readonly projectContext?:
    | {
        readonly cacheRoot: string;
        readonly projectRoot?: string | undefined;
        readonly startDirectory?: string | undefined;
      }
    | undefined;
  readonly cacheRoot?: string | undefined;
}): ContentAddressedTargetRequest {
  const retrievalMethod = resolveRequestedRetrievalMethod(input.retrievalMethod);
  if (input.projectContext !== undefined) {
    return Object.freeze({
      kind: "project",
      retrievalMethod,
      cacheRoot: input.projectContext.cacheRoot,
      ...(input.projectContext.projectRoot === undefined
        ? {}
        : { projectRoot: input.projectContext.projectRoot }),
      ...(input.projectContext.startDirectory === undefined
        ? {}
        : { startDirectory: input.projectContext.startDirectory }),
    });
  }
  return Object.freeze({
    kind: "store",
    retrievalMethod,
    cacheRoot: input.cacheRoot ?? defaultQueryArtifactCacheRoot(),
  });
}

function indexFailure(error: unknown) {
  if (error instanceof BackendRemoteError && error.code === "usage.invalid")
    return status(400, domainError(error.code, "The command invocation is invalid."));
  if (error instanceof EmbeddingError) {
    return status(503, { error: { code: error.code, message: error.message } });
  }
  if (error instanceof StoreBusyError)
    return status(503, domainError("store.busy", "The local Pack store is busy."));
  if (error instanceof StoreRecoveryRequiredError)
    return status(
      503,
      domainError("store.recovery-required", "The local Pack store requires recovery."),
    );
  return status(
    503,
    backendErrorBody(error instanceof BackendError ? error.code : "backend.failed"),
  );
}

function domainError(code: string, message: string) {
  return { error: { code, message } };
}
