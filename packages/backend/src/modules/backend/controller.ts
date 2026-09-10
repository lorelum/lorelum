import { Elysia } from "elysia";
import { identityQuerySchema, identitySchema, statusSchema } from "./model";
import type { BackendService } from "./service";

export function backendController(service: BackendService) {
  const controls = new Elysia({ normalize: false })
    .get("/status", () => service.status(), { response: { 200: statusSchema } })
    .post(
      "/stop",
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

  return new Elysia({ prefix: "/internal/v1", normalize: false })
    .get(
      "/identity",
      ({ query }) => {
        return service.identify(query.nonce);
      },
      { query: identityQuerySchema, response: { 200: identitySchema } },
    )
    .use(controls);
}
