import { expect, test } from "bun:test";
import {
  createTraceId,
  MemoryLogSink,
  noopEmitter,
  SinkLogEmitter,
  TraceDetailLogEmitter,
  type LogEmitter,
} from "@lorelum/log";
import { createBackendApp } from "../../app";
import type { QueryService } from "@lorelum/engine";
import { DEFAULT_BACKEND_SETTINGS } from "../../config/model";
import { DIAGNOSTIC_LEVEL_HEADER, TRACE_ID_HEADER } from "../../protocol/constants";
import { createBackendService } from "../backend/service";
import { createEmbeddingService } from "./service";
import { EmbeddingError } from "./errors";
import { embeddingController } from "./controller";
import { createContentAddressedSemanticRuntimeStub } from "../query/content-addressed-semantic-runtime.test-helper";

function fixture(
  overrides: Partial<Parameters<typeof createEmbeddingService>[0]> = {},
  diagnostics: LogEmitter = noopEmitter,
) {
  const embedding = createEmbeddingService({
    settings: DEFAULT_BACKEND_SETTINGS,
    diagnostics,
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
    diagnostics,
  });
  function request(
    path: string,
    method = "GET",
    body?: unknown,
    authorized = true,
    metadata: { readonly traceId?: string; readonly debug?: boolean } = {},
  ) {
    return app.handle(
      new Request(`http://127.0.0.1/internal/v1${path}`, {
        method,
        headers: {
          host: "127.0.0.1:26186",
          "content-type": "application/json",
          ...(authorized ? { authorization: "Bearer test" } : {}),
          ...(metadata.traceId === undefined ? {} : { [TRACE_ID_HEADER]: metadata.traceId }),
          ...(metadata.debug ? { [DIAGNOSTIC_LEVEL_HEADER]: "debug" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  return { request, embedding };
}

test.each([
  { route: "/model/load", debug: true },
  { route: "/model/load", debug: false },
  { route: "/model/prepare", debug: true },
  { route: "/model/prepare", debug: false },
])(
  "$route forwards trace-scoped debug=$debug through a failing preparation",
  async ({ route, debug }) => {
    const sink = new MemoryLogSink();
    const diagnostics = new TraceDetailLogEmitter("info", new SinkLogEmitter(sink));
    const traceId = createTraceId();
    let finishPreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const f = fixture(
      {
        prepareModel: async (_signal, _progress, preparationDiagnostics) => {
          preparationDiagnostics.emit({
            level: "debug",
            component: "backend",
            event: "backend.preparation.resource-check",
            resource: "native/runtime",
          });
          await preparationGate;
          throw new EmbeddingError("embedding.not-configured");
        },
      },
      diagnostics,
    );

    const response = await f.request(route, "POST", {}, true, { traceId, debug });
    expect(response.status).toBe(202);
    const accepted = sink.records.find((record) => record.message === "trace.preparation.accepted");
    expect(accepted).toMatchObject({
      traceId,
      requestId: expect.any(String),
      preparationId: expect.any(String),
    });

    finishPreparation();
    await expect(f.embedding.load()).rejects.toMatchObject({ code: "embedding.not-configured" });

    const resourceCheck = sink.records.find(
      (record) => record.message === "backend.preparation.resource-check",
    );
    if (debug) {
      expect(resourceCheck).toMatchObject({
        level: "debug",
        preparationId: accepted?.preparationId,
      });
    } else {
      expect(resourceCheck).toBeUndefined();
    }
    expect(sink.records).toContainEqual(
      expect.objectContaining({
        message: "backend.preparation.failed",
        preparationId: accepted?.preparationId,
      }),
    );
  },
);

test("a debug request joining a normal preparation captures only its shared lifecycle", async () => {
  const sink = new MemoryLogSink();
  const diagnostics = new TraceDetailLogEmitter("info", new SinkLogEmitter(sink));
  const normalTraceId = createTraceId();
  const joiningTraceId = createTraceId();
  const laterNormalTraceId = createTraceId();
  let startFirstDetails!: () => void;
  const firstDetailsGate = new Promise<void>((resolve) => {
    startFirstDetails = resolve;
  });
  let finishFirstPreparation!: () => void;
  const firstPreparationGate = new Promise<void>((resolve) => {
    finishFirstPreparation = resolve;
  });
  let firstDetailWritten!: () => void;
  const firstDetailWrittenPromise = new Promise<void>((resolve) => {
    firstDetailWritten = resolve;
  });
  let finishLaterPreparation!: () => void;
  const laterPreparationGate = new Promise<void>((resolve) => {
    finishLaterPreparation = resolve;
  });
  let laterDetailWritten!: () => void;
  const laterDetailWrittenPromise = new Promise<void>((resolve) => {
    laterDetailWritten = resolve;
  });
  let attempts = 0;
  const f = fixture(
    {
      prepareModel: async (_signal, _progress, preparationDiagnostics) => {
        const attempt = ++attempts;
        if (attempt === 1) await firstDetailsGate;
        preparationDiagnostics.emit({
          level: "debug",
          component: "backend",
          event: "backend.preparation.stage-detail",
          attempt,
        });
        if (attempt === 1) firstDetailWritten();
        else laterDetailWritten();
        await (attempt === 1 ? firstPreparationGate : laterPreparationGate);
        throw new EmbeddingError("embedding.not-configured");
      },
    },
    diagnostics,
  );

  expect(
    (await f.request("/model/load", "POST", {}, true, { traceId: normalTraceId })).status,
  ).toBe(202);
  const normalAcceptance = sink.records.find(
    (record) => record.message === "trace.preparation.accepted" && record.traceId === normalTraceId,
  );
  expect(normalAcceptance?.preparationId).toBeDefined();

  expect(
    (
      await f.request("/model/prepare", "POST", {}, true, {
        traceId: joiningTraceId,
        debug: true,
      })
    ).status,
  ).toBe(202);
  const joiningAcceptance = sink.records.find(
    (record) =>
      record.message === "trace.preparation.accepted" && record.traceId === joiningTraceId,
  );
  expect(joiningAcceptance?.preparationId).toBe(normalAcceptance?.preparationId);

  startFirstDetails();
  await firstDetailWrittenPromise;
  const sharedDetail = sink.records.find(
    (record) =>
      record.message === "backend.preparation.stage-detail" && record.context?.attempt === 1,
  );
  expect(sharedDetail).toMatchObject({
    level: "debug",
    preparationId: normalAcceptance?.preparationId,
  });
  expect(sharedDetail).not.toHaveProperty("traceId");
  expect(sharedDetail).not.toHaveProperty("requestId");

  finishFirstPreparation();
  await expect(f.embedding.load()).rejects.toMatchObject({ code: "embedding.not-configured" });

  expect(
    (await f.request("/model/load", "POST", {}, true, { traceId: laterNormalTraceId })).status,
  ).toBe(202);
  const laterAcceptance = sink.records.find(
    (record) =>
      record.message === "trace.preparation.accepted" && record.traceId === laterNormalTraceId,
  );
  expect(laterAcceptance?.preparationId).not.toBe(normalAcceptance?.preparationId);
  await laterDetailWrittenPromise;
  expect(
    sink.records.find(
      (record) =>
        record.message === "backend.preparation.stage-detail" && record.context?.attempt === 2,
    ),
  ).toBeUndefined();

  finishLaterPreparation();
  await expect(f.embedding.load()).rejects.toMatchObject({ code: "embedding.not-configured" });
});

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

test("unknown model load fields are rejected", async () => {
  const f = fixture();
  expect((await f.request("/model/load", "POST", { endpoint: "http://example.test" })).status).toBe(
    400,
  );
});

test.each([{ inputs: [] }, { inputs: ["  \n"] }, { inputs: Array<string>(9).fill("text") }])(
  "invalid embedding input is rejected at HTTP ingress: %p",
  async ({ inputs }) => {
    const f = fixture();
    expect((await f.request("/embeddings", "POST", { kind: "query", inputs })).status).toBe(400);
  },
);

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
