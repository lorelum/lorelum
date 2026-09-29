import { expect, test } from "bun:test";
import { createBackendApp } from "../../app";
import type { QueryService } from "@lorelum/engine";
import { DEFAULT_BACKEND_SETTINGS } from "../../config/model";
import { createBackendService } from "../backend/service";
import { createEmbeddingService } from "./service";
import { EmbeddingError } from "./errors";
import { embeddingController } from "./controller";
import { createContentAddressedSemanticRuntimeStub } from "../query/content-addressed-semantic-runtime.test-helper";

function fixture(overrides: Partial<Parameters<typeof createEmbeddingService>[0]> = {}) {
  const embedding = createEmbeddingService({
    settings: DEFAULT_BACKEND_SETTINGS,
    createRuntime() {
      throw new EmbeddingError("embedding.not-configured");
    },
    ...overrides,
  });
  const backend = createBackendService({
    identity: { instanceId: "test", buildIdentity: "test", protocolVersion: 1 },
    secret: "test",
    onStop() {},
    modelState: () => embedding.status().state,
  });
  const keywordQueryService: QueryService = {
    async query() {
      return { mode: "keyword", results: [] };
    },
  };
  const app = createBackendApp({
    backend,
    embedding,
    keywordQueryService,
    semanticRuntime: createContentAddressedSemanticRuntimeStub(),
  });
  function request(path: string, method = "GET", body?: unknown, authorized = true) {
    return app.handle(
      new Request(`http://127.0.0.1/internal/v1${path}`, {
        method,
        headers: {
          host: "127.0.0.1:26186",
          "content-type": "application/json",
          ...(authorized ? { authorization: "Bearer test" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  return { request, embedding };
}

test("embedding endpoints share authentication and private error mapping", async () => {
  const f = fixture();
  expect((await f.request("/model/status", "GET", undefined, false)).status).toBe(401);
  expect((await f.request("/model/status")).status).toBe(200);
  const accepted = await f.request("/model/load", "POST", {});
  expect(accepted.status).toBe(202);
  await Bun.sleep(0);
  expect(await (await f.request("/model/status")).json()).toMatchObject({
    state: "failed",
    error: "embedding.not-configured",
  });
  expect(await (await f.request("/status")).json()).toMatchObject({
    state: "ready",
    model: "failed",
  });
  expect((await f.request("/model/unload", "POST", {})).status).toBe(200);
});

test("model failure status and HTTP errors retain structured resource details", async () => {
  const resource = {
    kind: "native",
    file: "native/darwin-arm64/llama-server",
    check: "missing",
  } as const;
  const f = fixture({
    prepareModel: async () => {
      throw new EmbeddingError("embedding.native-resource-invalid", undefined, resource);
    },
  });
  expect((await f.request("/model/load", "POST", {})).status).toBe(202);
  await Bun.sleep(0);

  const status = await f.request("/model/status");
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({
    state: "failed",
    error: "embedding.native-resource-invalid",
    resource,
  });

  const retry = await f.request("/model/prepare", "POST", {});
  expect(retry.status).toBe(503);
  expect(await retry.json()).toMatchObject({
    error: {
      code: "embedding.native-resource-invalid",
      resource,
    },
  });
});

test("unknown load fields and blank embedding inputs are rejected", async () => {
  const f = fixture();
  expect((await f.request("/model/load", "POST", { endpoint: "http://example.test" })).status).toBe(
    400,
  );
  expect((await f.request("/embeddings", "POST", { kind: "query", inputs: ["  "] })).status).toBe(
    400,
  );
});

test("only configured preparation routes are exposed", async () => {
  const f = fixture();
  expect((await f.request("/model/prepare", "POST", {}, false)).status).toBe(401);
  expect((await f.request("/model/prepare", "POST", { policy: "offline" })).status).toBe(400);
  // The full application deliberately maps every unknown route to invalid-request.
  expect((await f.request("/model/prepare-local", "POST", {})).status).toBe(400);
  expect((await f.request(`/model/prepare-local/${crypto.randomUUID()}`)).status).toBe(400);
  const controller = embeddingController(f.embedding, () => true);
  expect(
    (
      await controller.handle(
        new Request("http://localhost/internal/v1/model/prepare-local", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await controller.handle(
        new Request(`http://localhost/internal/v1/model/prepare-local/${crypto.randomUUID()}`),
      )
    ).status,
  ).toBe(404);
  expect((await f.request("/model/status")).status).toBe(200);
});
