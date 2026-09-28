import { embeddingController } from "./modules/embedding/controller";
import type { EmbeddingService } from "./modules/embedding/service";
import type { QueryService } from "@lorelum/engine";
import { Elysia } from "elysia";
import { backendController } from "./modules/backend/controller";
import type { BackendService } from "./modules/backend/service";
import { queryController } from "./modules/query/controller";
import { indexController } from "./modules/index/controller";
import type { ContentAddressedSemanticRuntimePort } from "./modules/query/content-addressed-semantic-runtime";
import { practiceHintController } from "./modules/practice-hints/controller";
import type { PracticeHintService } from "./modules/practice-hints/service";
import { localBoundary, reject } from "./plugins/local-auth";
import { BACKEND_HOST, BACKEND_PORT } from "./protocol/constants";
import { noopEmitter, type LogEmitter } from "@lorelum/log";

export interface CreateBackendAppOptions {
  readonly backend: BackendService;
  readonly embedding?: EmbeddingService;
  readonly keywordQueryService: QueryService;
  readonly semanticRuntime: ContentAddressedSemanticRuntimePort;
  readonly practiceHints?: PracticeHintService;
  readonly diagnostics?: LogEmitter;
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
  const diagnostics = options.diagnostics ?? noopEmitter;
  return new Elysia({ normalize: false })
    .use(localBoundary(port, backend.authenticate))
    .onError(({ code, error }) => {
      const responseFailure = "type" in error && error.type === "response";
      return (code === "VALIDATION" && !responseFailure) || code === "PARSE" || code === "NOT_FOUND"
        ? reject(400, "backend.invalid-request")
        : reject(500, "backend.failed");
    })
    .use(backendController(backend))
    .use(
      options.embedding
        ? embeddingController(options.embedding, backend.available, diagnostics)
        : new Elysia(),
    )
    .use(indexController(options.semanticRuntime, backend.available, diagnostics))
    .use(
      options.practiceHints
        ? practiceHintController(options.practiceHints, backend.available)
        : new Elysia(),
    )
    .use(
      queryController(
        {
          keywordQueryService: options.keywordQueryService,
          semanticRuntime: options.semanticRuntime,
        },
        backend.available,
        diagnostics,
      ),
    );
}
