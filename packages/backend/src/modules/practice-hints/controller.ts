import { Elysia } from "elysia";

import { BACKEND_ROUTES } from "../../protocol/constants";
import { reject, requireJson } from "../../plugins/local-auth";
import type { PracticeHintService } from "./service";
import {
  practiceHintAckSchema,
  readHintsQuerySchema,
  readHintsResponseSchema,
  shellToolEventSchema,
  successfulGetReportSchema,
} from "./model";

export function practiceHintController(service: PracticeHintService, available: () => boolean) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      if (request.method === "POST") return requireJson(request);
    })
    .post(
      BACKEND_ROUTES.practiceHintToolEvents,
      async ({ body }) => {
        await service.routeToolEvent(body);
        return { ok: true as const };
      },
      { body: shellToolEventSchema, response: { 200: practiceHintAckSchema } },
    )
    .post(
      BACKEND_ROUTES.practiceHintReads,
      async ({ body }) => {
        await service.recordSuccessfulGet(body.cwd, body.hint, body.session);
        return { ok: true as const };
      },
      { body: successfulGetReportSchema, response: { 200: practiceHintAckSchema } },
    )
    .get(
      BACKEND_ROUTES.practiceHintSessions,
      ({ query }) => service.readRecentHints(query.hostKey, query.sessionId),
      { query: readHintsQuerySchema, response: { 200: readHintsResponseSchema } },
    );
}
