import { BACKEND_ROUTES } from "../../protocol/constants";
import {
  InvalidQueryRequestError,
  KeywordIndexError,
  KeywordIndexUnavailableError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type QueryService,
  type QueryResult,
} from "@lorelum/engine";
import { Elysia, status } from "elysia";
import { reject, requireJson } from "../../plugins/local-auth";
import { backendErrorBody, errorSchema } from "../../protocol/errors";
import { queryRequestSchema, queryResultSchema, type BackendQueryResult } from "./model";

/** QueryService already owns the use case; this controller only adapts transport. */
export function queryController(service: QueryService, available: () => boolean) {
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
          return toResponse(await service.query({ rootPath: body.storageRoot }, query));
        } catch (error) {
          if (error instanceof InvalidQueryRequestError)
            return status(400, domainError("usage.invalid", "The command invocation is invalid."));
          if (error instanceof KeywordIndexUnavailableError)
            return status(503, domainError("query.unavailable", "Keyword query is unavailable."));
          if (error instanceof KeywordIndexError)
            return status(500, domainError("query.failed", "Keyword query failed."));
          if (error instanceof StoreBusyError)
            return status(503, domainError("store.busy", "The local Pack store is busy."));
          if (error instanceof StoreRecoveryRequiredError)
            return status(
              503,
              domainError("store.recovery-required", "The local Pack store requires recovery."),
            );
          return status(500, backendErrorBody("backend.failed"));
        }
      },
      {
        body: queryRequestSchema,
        response: { 200: queryResultSchema, 400: errorSchema, 500: errorSchema, 503: errorSchema },
      },
    );
}
function domainError(code: string, message: string) {
  return { error: { code, message } };
}
function toResponse(result: QueryResult): BackendQueryResult {
  return {
    mode: result.mode,
    results: result.results.map((hit) => ({
      practiceId: hit.practiceId,
      title: hit.title,
      stage: hit.stage,
      techStack: [...hit.techStack],
      appliesWhen: hit.appliesWhen,
      severity: hit.severity,
      contentDigest: hit.contentDigest,
    })),
  };
}
