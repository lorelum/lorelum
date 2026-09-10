import { Elysia } from "elysia";
import { backendController } from "./modules/backend/controller";
import type { BackendService } from "./modules/backend/service";
import { localBoundary, reject } from "./plugins/local-auth";
import { BACKEND_HOST, BACKEND_PORT } from "./protocol/constants";

export interface CreateBackendAppOptions {
  readonly backend: BackendService;
  /** Internal test injection; production always uses the fixed IPv4 endpoint. */
  readonly host?: string;
  readonly port?: number;
}

/** Composition only: feature controllers own routes, services own state. */
export function createBackendApp(options: CreateBackendAppOptions) {
  const port = options.port ?? BACKEND_PORT;
  if (
    (options.host ?? BACKEND_HOST) !== BACKEND_HOST ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new TypeError("Invalid local backend configuration");
  }
  const { backend } = options;
  return new Elysia({ normalize: false })
    .use(localBoundary(port, backend.authenticate))
    .onError(({ code, error }) => {
      const responseFailure = "type" in error && error.type === "response";
      return (code === "VALIDATION" && !responseFailure) || code === "PARSE" || code === "NOT_FOUND"
        ? reject(400, "backend.invalid-request")
        : reject(500, "backend.failed");
    })
    .use(backendController(backend));
}
