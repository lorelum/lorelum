import { BACKEND_ROUTES } from "../../protocol/constants";
import { Elysia, status } from "elysia";
import {
  reject,
  requestDiagnosticLevel,
  requestTraceId,
  requireJson,
} from "../../plugins/local-auth";
import { errorSchema } from "../../protocol/errors";
import {
  embeddingRequestSchema,
  embeddingResultSchema,
  emptyModelRequestSchema,
  modelStatusSchema,
  modelPreparationSchema,
  modelPreparationParamsSchema,
} from "./dto";
import { EmbeddingError } from "./errors";
import type { EmbeddingService } from "./service";

const modelResponses = {
  200: modelStatusSchema,
  202: modelStatusSchema,
  400: errorSchema,
  503: errorSchema,
};
const modelMutation = { body: emptyModelRequestSchema, response: modelResponses };

export function embeddingController(service: EmbeddingService, available: () => boolean) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      if (request.method === "POST") return requireJson(request);
    })
    .get(BACKEND_ROUTES.modelStatus, () => service.status(), {
      response: modelResponses,
    })
    .post(
      BACKEND_ROUTES.modelLoad,
      ({ request }) =>
        invoke(async () => {
          const result = service.beginLoad(preparationDiagnosticContext(request));
          return status(result.state === "ready" ? 200 : 202, result);
        }),
      modelMutation,
    )
    .post(BACKEND_ROUTES.modelUnload, () => invoke(() => service.unload()), modelMutation)
    .post(
      BACKEND_ROUTES.modelPrepare,
      ({ request }) =>
        invoke(async () => {
          const result = service.beginModelPreparation(preparationDiagnosticContext(request));
          return status(result.status.state === "ready" ? 200 : 202, result);
        }),
      {
        body: emptyModelRequestSchema,
        response: {
          200: modelPreparationSchema,
          202: modelPreparationSchema,
          400: errorSchema,
          503: errorSchema,
        },
      },
    )
    .get(
      BACKEND_ROUTES.modelPreparation,
      ({ params }) => invoke(async () => service.modelPreparation(params.preparationId)),
      {
        params: modelPreparationParamsSchema,
        response: { 200: modelPreparationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .post(
      BACKEND_ROUTES.embeddings,
      ({ body }) => invoke(() => service.embed(body.kind, body.inputs)),
      {
        body: embeddingRequestSchema,
        response: { 200: embeddingResultSchema, 400: errorSchema, 503: errorSchema },
      },
    );
}

function preparationDiagnosticContext(request: Request) {
  return {
    traceId: requestTraceId(request),
    diagnosticLevel: requestDiagnosticLevel(request),
  };
}

async function invoke<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof EmbeddingError)) throw error;
    const code = error.code;
    const httpStatus = code === "embedding.input-invalid" ? 400 : 503;
    return status(httpStatus, {
      error: {
        code,
        message: error.message,
        ...(error.resource === undefined ? {} : { resource: error.resource }),
      },
    });
  }
}
