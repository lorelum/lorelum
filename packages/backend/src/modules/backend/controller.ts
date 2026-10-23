import { BACKEND_ROUTES } from "../../protocol/constants";
import { Elysia } from "elysia";
import {
  identityQuerySchema,
  identitySchema,
  statusSchema,
  stopRequestSchema,
  stopResponseSchema,
} from "./model";
import type { BackendService } from "./service";

export function backendController(service: BackendService) {
  const controls = new Elysia({ normalize: false })
    .get(BACKEND_ROUTES.status, () => service.status(), { response: { 200: statusSchema } })
    .post(
      BACKEND_ROUTES.stop,
      async ({ body }) => {
        const result =
          body?.ifIdle === true
            ? await service.tryBeginIdleStop()
            : { state: "accepted" as const, status: service.beginStop() };
        if (result.state === "deferred") return result;
        // Schedule shutdown after the HTTP response; the service makes it idempotent.
        setTimeout(() => {
          void service.stop();
        }, 0);
        return result.status;
      },
      {
        body: stopRequestSchema,
        response: { 200: stopResponseSchema },
      },
    );

  return new Elysia({ normalize: false })
    .get(
      BACKEND_ROUTES.identity,
      ({ query }) => {
        return service.identify(query.nonce);
      },
      { query: identityQuerySchema, response: { 200: identitySchema } },
    )
    .use(controls);
}
