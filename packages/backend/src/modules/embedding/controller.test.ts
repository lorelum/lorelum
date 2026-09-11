import { expect, test } from "bun:test";
import { createBackendApp } from "../../app";
import { DEFAULT_BACKEND_SETTINGS } from "../../config/model";
import { createBackendService } from "../backend/service";
import { createEmbeddingService } from "./service";
import { EmbeddingError } from "./errors";

function fixture() {
  const embedding = createEmbeddingService({
    settings: DEFAULT_BACKEND_SETTINGS,
    createRuntime() {
      throw new EmbeddingError("embedding.not-configured");
    },
  });
  const backend = createBackendService({
    identity: { instanceId: "test", buildIdentity: "test", protocolVersion: 1 },
    secret: "test",
    onStop() {},
    modelState: () => embedding.status().state,
  });
  const app = createBackendApp({
    backend,
    embedding,
    queryService: {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
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
  return { request };
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

test("unknown load fields and blank embedding inputs are rejected", async () => {
  const f = fixture();
  expect((await f.request("/model/load", "POST", { endpoint: "http://example.test" })).status).toBe(
    400,
  );
  expect((await f.request("/embeddings", "POST", { kind: "query", inputs: ["  "] })).status).toBe(
    400,
  );
});
