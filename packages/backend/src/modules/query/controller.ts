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
  type QueryResult,
  type QueryService,
  type SemanticQueryResult,
  type SemanticQueryService,
} from "@lorelum/engine";
import { Elysia, status } from "elysia";
import { reject, requireJson } from "../../plugins/local-auth";
import { backendErrorBody, errorSchema } from "../../protocol/errors";
import { EmbeddingError } from "../embedding/errors";
import { queryRequestSchema, queryResultSchema, type BackendQueryResult } from "./model";

export interface QueryControllerServices {
  readonly keywordQueryService: QueryService;
  readonly semanticQueryService: SemanticQueryService;
}

/** The controller selects the Engine use case; it does not implement retrieval rules. */
export function queryController(services: QueryControllerServices, available: () => boolean) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      return requireJson(request);
    })
    .post(
      BACKEND_ROUTES.query,
      async ({ body }) => {
        try {
          const query = {
            text: body.query.text,
            ...(body.query.limit === undefined ? {} : { limit: body.query.limit }),
          };
          if ((body.query.mode ?? "semantic") === "keyword") {
            return toResponse(
              await services.keywordQueryService.query({ rootPath: body.storageRoot }, query),
            );
          }
          return toResponse(
            await services.semanticQueryService.query({ rootPath: body.storageRoot }, query),
          );
        } catch (error) {
          return queryFailure(error);
        }
      },
      {
        body: queryRequestSchema,
        response: { 200: queryResultSchema, 400: errorSchema, 500: errorSchema, 503: errorSchema },
      },
    );
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
    return status(503, { error: { code: error.code, message: error.message } });
  if (error instanceof StoreBusyError)
    return status(503, domainError("store.busy", "The local Pack store is busy."));
  if (error instanceof StoreRecoveryRequiredError)
    return status(
      503,
      domainError("store.recovery-required", "The local Pack store requires recovery."),
    );
  return status(500, backendErrorBody("backend.failed"));
}

function domainError(code: string, message: string) {
  return { error: { code, message } };
}

function toResponse(result: QueryResult | SemanticQueryResult): BackendQueryResult {
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
  return { mode: "semantic", profileId: result.profileId, coverage: result.coverage, results };
}
