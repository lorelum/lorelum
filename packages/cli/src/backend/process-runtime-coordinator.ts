import {
  createBackendRuntimeCoordinator,
  type BackendRuntimeCoordinator,
} from "@lorelum/backend/coordination";
import type { TraceId } from "@lorelum/log";

import { createProcessBackendSupervisor } from "./control-commands";
import { createProcessBackendClient } from "./process-client.js";

/** Shares per-invocation Backend connection/start wiring across semantic CLI routes. */
export function createProcessBackendRuntimeCoordinator(
  traceId?: TraceId,
  debug = false,
): BackendRuntimeCoordinator {
  return createBackendRuntimeCoordinator({
    connect: () => createProcessBackendClient(traceId, debug),
    start: async () => (await createProcessBackendSupervisor()).start(),
  });
}
