import { BACKEND_ROUTES } from "../../protocol/constants";
import {
  InvalidQueryRequestError,
  KeywordIndexError,
  KeywordIndexUnavailableError,
  SemanticEmbeddingError,
  SemanticIndexError,
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  defaultQueryArtifactCacheRoot,
  type QueryResult,
  type QueryService,
  type SemanticQueryResult,
} from "@lorelum/engine";
import { Elysia, status } from "elysia";
import { randomUUID } from "node:crypto";
import {
  reject,
  requestDiagnosticLevel,
  requestTraceId,
  requireJson,
} from "../../plugins/local-auth";
import { noopEmitter, withDiagnosticLevel, type LogEmitter } from "@lorelum/log";
import { backendErrorBody, errorSchema } from "../../protocol/errors";
import { EmbeddingError } from "../embedding/errors";
import { queryRequestSchema, queryResultSchema, type BackendQueryResult } from "./model";
import type {
  ContentAddressedSemanticRuntimePort,
  ContentAddressedSemanticQueryResult,
  ContentAddressedTargetRequest,
} from "./content-addressed-semantic-runtime";

export interface QueryControllerServices {
  readonly keywordQueryService: QueryService;
  readonly semanticRuntime: ContentAddressedSemanticRuntimePort;
}

/** The controller selects the Engine use case; it does not implement retrieval rules. */
export function queryController(
  services: QueryControllerServices,
  available: () => boolean,
  diagnostics: LogEmitter = noopEmitter,
) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      return requireJson(request);
    })
    .post(
      BACKEND_ROUTES.query,
      async ({ body, request }) => {
        const traceId = requestTraceId(request);
        const requestDiagnostics = withDiagnosticLevel(
          diagnostics,
          requestDiagnosticLevel(request),
        );
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
            route: "query",
            query: body.query.text,
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
          const query = {
            text: body.query.text,
            ...(body.query.limit === undefined ? {} : { limit: body.query.limit }),
          };
          const result =
            (body.query.mode ?? "semantic") === "keyword"
              ? await services.keywordQueryService.query(
                  { rootPath: body.storageRoot },
                  query,
                  traceId === undefined ? undefined : { emitter: requestDiagnostics, traceId },
                )
              : await services.semanticRuntime.query(
                  { rootPath: body.storageRoot },
                  targetFor(body.query),
                  query,
                  {
                    maxWaitMs: body.query.maxWaitMs ?? 3_000,
                    minCoveragePercent: body.query.minCoveragePercent ?? 0,
                  },
                );
          const response = toResponse(result);
          if (traceId !== undefined) {
            const operationId = "operationId" in response ? response.operationId : undefined;
            const preparationId = "preparationId" in response ? response.preparationId : undefined;
            if (operationId !== undefined) {
              requestDiagnostics.emit({
                time: new Date().toISOString(),
                level: "info",
                component: "backend",
                event: "trace.operation.accepted",
                traceId,
                requestId,
                operationId,
              });
            }
            if (preparationId !== undefined) {
              requestDiagnostics.emit({
                time: new Date().toISOString(),
                level: "info",
                component: "backend",
                event: "trace.preparation.accepted",
                traceId,
                requestId,
                preparationId,
              });
            }
            requestDiagnostics.emit({
              time: new Date().toISOString(),
              level: "info",
              component: "backend",
              event: "backend.request.completed",
              traceId,
              requestId,
              route: "query",
              method: "POST",
              status: 200,
              ...(operationId === undefined ? {} : { operationId }),
              ...(preparationId === undefined ? {} : { preparationId }),
              durationMs: Date.now() - startedAt,
            });
          }
          return response;
        } catch (error) {
          const failure = queryFailureDiagnostic(error);
          const rawError = rawErrorEvidence(error);
          if (traceId !== undefined) {
            requestDiagnostics.emit({
              time: new Date().toISOString(),
              level: "error",
              component: "backend",
              event: "backend.request.failed",
              traceId,
              requestId,
              route: "query",
              method: "POST",
              status: failure.status,
              durationMs: Date.now() - startedAt,
              code: failure.code,
              ...(rawError === undefined ? {} : { rawError }),
            });
          }
          return queryFailure(error);
        }
      },
      {
        body: queryRequestSchema,
        response: { 200: queryResultSchema, 400: errorSchema, 500: errorSchema, 503: errorSchema },
      },
    );
}

function targetFor(input: {
  readonly projectContext?:
    | {
        readonly projectRoot?: string | undefined;
        readonly startDirectory?: string | undefined;
        readonly cacheRoot: string;
      }
    | undefined;
  readonly cacheRoot?: string | undefined;
}): ContentAddressedTargetRequest {
  if (input.projectContext !== undefined) {
    return Object.freeze({
      kind: "project",
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
    cacheRoot: input.cacheRoot ?? defaultQueryArtifactCacheRoot(),
  });
}

function queryFailureDiagnostic(error: unknown): {
  readonly status: number;
  readonly code: string;
} {
  if (error instanceof InvalidQueryRequestError) return { status: 400, code: "usage.invalid" };
  if (error instanceof KeywordIndexUnavailableError)
    return { status: 503, code: "query.unavailable" };
  if (error instanceof KeywordIndexError) return { status: 500, code: "query.failed" };
  if (error instanceof SemanticIndexNotReadyError)
    return { status: 503, code: "semantic.index-not-ready" };
  if (error instanceof SemanticIndexIncompatibleError)
    return { status: 503, code: "semantic.index-incompatible" };
  if (error instanceof SemanticEmbeddingError)
    return { status: 503, code: "semantic.embedding-failed" };
  if (error instanceof SemanticIndexQueryError || error instanceof SemanticIndexError)
    return { status: 500, code: "semantic.index-failed" };
  if (error instanceof EmbeddingError) return { status: 503, code: error.code };
  if (error instanceof StoreBusyError) return { status: 503, code: "store.busy" };
  if (error instanceof StoreRecoveryRequiredError)
    return { status: 503, code: "store.recovery-required" };
  return { status: 500, code: "backend.failed" };
}

function queryFailure(error: unknown) {
  if (error instanceof InvalidQueryRequestError)
    return status(400, domainError("usage.invalid", "The command invocation is invalid."));
  if (error instanceof KeywordIndexUnavailableError)
    return status(503, domainError("query.unavailable", "Keyword query is unavailable."));
  if (error instanceof KeywordIndexError)
    return status(500, domainError("query.failed", "Keyword query failed."));
  if (error instanceof SemanticIndexNotReadyError)
    return status(503, domainError("semantic.index-not-ready", "Build the semantic index first."));
  if (error instanceof SemanticIndexIncompatibleError)
    return status(
      503,
      domainError("semantic.index-incompatible", "The semantic index is incompatible."),
    );
  if (error instanceof SemanticEmbeddingError)
    return status(
      503,
      domainError("semantic.embedding-failed", "Semantic query embedding failed."),
    );
  if (error instanceof SemanticIndexQueryError || error instanceof SemanticIndexError)
    return status(
      500,
      domainError("semantic.index-failed", "The semantic index could not answer the query."),
    );
  if (error instanceof EmbeddingError)
    return status(503, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.resource === undefined ? {} : { resource: error.resource }),
      },
    });
  if (error instanceof StoreBusyError)
    return status(503, domainError("store.busy", "The local Pack store is busy."));
  if (error instanceof StoreRecoveryRequiredError)
    return status(
      503,
      domainError("store.recovery-required", "The local Pack store requires recovery."),
    );
  return status(500, backendErrorBody("backend.failed"));
}

function rawErrorEvidence(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const value = `${error.name}: ${error.message}`;
  return /\b(?:authorization|cookie)\s*[:=]|\bbearer\s+\S+|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i.test(
    value,
  )
    ? undefined
    : value;
}

function domainError(code: string, message: string) {
  return { error: { code, message } };
}

function toResponse(
  result: QueryResult | SemanticQueryResult | ContentAddressedSemanticQueryResult,
): BackendQueryResult {
  if ("state" in result) return result;
  const results = result.results.map((hit) => ({
    practiceId: hit.practiceId,
    title: hit.title,
    stage: hit.stage,
    techStack: [...hit.techStack],
    appliesWhen: hit.appliesWhen,
    severity: hit.severity,
    contentDigest: hit.contentDigest,
  }));
  if (result.mode === "keyword") return { mode: "keyword", results };
  return {
    mode: "semantic",
    profileId: result.profileId,
    coverage: result.coverage,
    ...("indexedPracticeCount" in result
      ? {
          indexedPracticeCount: result.indexedPracticeCount,
          totalPracticeCount: result.totalPracticeCount,
          operationId: result.operationId,
        }
      : {}),
    ...("context" in result && result.context !== undefined ? { context: result.context } : {}),
    results,
  };
}
