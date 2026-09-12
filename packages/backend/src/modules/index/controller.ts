import { BACKEND_ROUTES } from "../../protocol/constants";
import { BackendError, backendErrorBody, errorSchema } from "../../protocol/errors";
import { Elysia, status } from "elysia";
import { requireJson, reject } from "../../plugins/local-auth";
import { EmbeddingError } from "../embedding/errors";
import { StoreBusyError, StoreRecoveryRequiredError } from "@lorelum/engine";
import {
  indexMutationSchema,
  indexOperationParamsSchema,
  indexOperationSchema,
  indexStatusQuerySchema,
  indexStatusSchema,
} from "./model";
import type { IndexOperationService } from "./operation-service";

/** HTTP/authentication adapter for a Backend-hosted Engine semantic index service. */
export function indexController(service: IndexOperationService, available: () => boolean) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      if (request.method === "POST") return requireJson(request);
    })
    .get(
      BACKEND_ROUTES.indexStatus,
      async ({ query }) => {
        try {
          return await service.status({ rootPath: query.storageRoot });
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
      ({ body }) => {
        try {
          return status(202, service.build({ rootPath: body.storageRoot }));
        } catch (error) {
          return indexFailure(error);
        }
      },
      {
        body: indexMutationSchema,
        response: { 202: indexOperationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .post(
      BACKEND_ROUTES.indexRebuild,
      ({ body }) => {
        try {
          return status(202, service.rebuild({ rootPath: body.storageRoot }));
        } catch (error) {
          return indexFailure(error);
        }
      },
      {
        body: indexMutationSchema,
        response: { 202: indexOperationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .get(
      BACKEND_ROUTES.indexOperation,
      ({ params }) => {
        const operation = service.operation(params.operationId);
        return operation === undefined
          ? status(400, backendErrorBody("backend.invalid-request"))
          : operation;
      },
      {
        params: indexOperationParamsSchema,
        response: { 200: indexOperationSchema, 400: errorSchema },
      },
    );
}

function indexFailure(error: unknown) {
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
