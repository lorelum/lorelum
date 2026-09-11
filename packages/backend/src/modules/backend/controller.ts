import { BACKEND_ROUTES } from "../../protocol/constants";
import { Elysia } from "elysia";
import { identityQuerySchema, identitySchema, statusSchema } from "./model";
import type { BackendService } from "./service";

export function backendController(service: BackendService) {
  const controls = new Elysia({ normalize: false })
    .get(BACKEND_ROUTES.status, () => service.status(), { response: { 200: statusSchema } })
    .post(
      BACKEND_ROUTES.stop,
      () => {
        const result = service.beginStop();
        // Schedule shutdown after the HTTP response; the service makes it idempotent.
        setTimeout(() => {
          void service.stop();
        }, 0);
        return result;
      },
      { response: { 200: statusSchema } },
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
