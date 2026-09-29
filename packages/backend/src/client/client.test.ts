import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryLogSink,
  SinkLogEmitter,
  TraceDetailLogEmitter,
  type LogEmitter,
} from "@lorelum/log";

import type { QueryRequest, QueryService, StorageRoot } from "@lorelum/engine";

import { createBackendApp } from "../app";
import { createEmbeddingService, type EmbeddingService } from "../modules/embedding/service";
import { createBackendService } from "../modules/backend/service";
import type { InstanceIdentity } from "../protocol/identity";
import { BackendRemoteError } from "../protocol/errors";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL, ENCODING_ID } from "../modules/embedding/model";
import { PROTOCOL_VERSION } from "../protocol/constants";
import { DEFAULT_BACKEND_SETTINGS } from "../config/model";
import { createBackendClient } from "./client";
import { createContentAddressedSemanticRuntimeStub } from "../modules/query/content-addressed-semantic-runtime.test-helper";
import type { ContentAddressedSemanticRuntimePort } from "../modules/query/content-addressed-semantic-runtime";
import { createPracticeHintService } from "../modules/practice-hints/service";
import type { ReadHint, ShellToolEvent } from "../modules/practice-hints/model";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  protocolVersion: PROTOCOL_VERSION,
});
const secret = "a secret used only by tests";
const apps: Array<ReturnType<typeof createBackendApp>> = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.stop(true);
});

function runningApp(
  keywordQueryService?: QueryService,
  backendIdentity: InstanceIdentity = identity,
  embedding?: EmbeddingService,
  semanticRuntime: ContentAddressedSemanticRuntimePort = createContentAddressedSemanticRuntimeStub(),
  diagnostics?: LogEmitter,
  practiceHints?: ReturnType<typeof createPracticeHintService>,
): {
  readonly app: ReturnType<typeof createBackendApp>;
  readonly url: string;
} {
  const keywordService: QueryService = keywordQueryService ?? {
    async query() {
      return { mode: "keyword", results: [] } as const;
    },
  };
  const app = createBackendApp({
    backend: createBackendService({ identity: backendIdentity, secret, onStop: () => undefined }),
    ...(embedding === undefined ? {} : { embedding }),
    keywordQueryService: keywordService,
    semanticRuntime,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(practiceHints === undefined ? {} : { practiceHints }),
  });
  apps.push(app);
  app.listen({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 65_536 });
  if (app.server === null) throw new Error("test server did not start");
  return { app, url: `http://127.0.0.1:${app.server.port}` };
}

describe("createBackendClient", () => {
  test("configured preparation returns before transfer completion and explicit load joins it", async () => {
    let finish!: (value: string) => void;
    const transfer = new Promise<string>((resolve) => {
      finish = resolve;
    });
    let prepares = 0;
    const service = createEmbeddingService({
      settings: DEFAULT_BACKEND_SETTINGS,
      prepareModel: async (_signal, progress) => {
        prepares++;
        progress({ phase: "downloading" });
        return transfer;
      },
      createRuntime: () => ({
        start: async () => {},
        stop: async () => {},
        encode: async () => [],
        exited: new Promise<void>(() => {}),
      }),
    });
    const { url } = runningApp(undefined, identity, service);
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    const accepted = await client.beginModelPreparation();
    expect(accepted.status.state).toBe("loading");
    expect((await client.beginModelPreparation()).preparationId).toBe(accepted.preparationId);
    const explicit = client.loadModel();
    expect((await client.modelPreparation(accepted.preparationId)).status.state).toBe("loading");
    finish("fixture");
    expect((await explicit).state).toBe("ready");
    expect((await client.modelPreparation(accepted.preparationId)).status.state).toBe("ready");
    expect(prepares).toBe(1);
    await client.unloadModel();
    await expect(client.modelPreparation(accepted.preparationId)).rejects.toMatchObject({
      code: "embedding.preparation-expired",
    });
    await expect(client.modelPreparation("invalid")).rejects.toMatchObject({
      code: "backend.invalid-request",
    });
  });

  test("rejects a changed preparation handle instead of following another load", async () => {
    const expectedId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const replacementId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const loading = {
      state: "loading" as const,
      encodingId: ENCODING_ID,
      device: "cpu" as const,
      dimensions: EMBEDDING_MODEL.dimensions,
      threads: 4,
    };
    const ready = { ...loading, state: "ready" as const };
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation: () => ({ preparationId: expectedId, status: loading }),
      modelPreparation: (preparationId) => {
        expect(preparationId).toBe(expectedId);
        return { preparationId: replacementId, status: ready };
      },
      waitModelPreparation: async () => ready,
      status: () => loading,
      beginLoad: () => loading,
      load: async () => loading,
      unload: async () => ({ ...ready, state: "unloaded" }),
      embed: async () => ({ encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] }),
      embedQuery: async () => ({ encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] }),
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    await expect(client.modelPreparation(expectedId)).rejects.toMatchObject({
      code: "embedding.preparation-expired",
    });
  });
  test("authenticates the service before making a strict-build query", async () => {
    const calls: unknown[] = [];
    const { url } = runningApp({
      async query(root, request) {
        calls.push({ root, request });
        return { mode: "keyword", results: [] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search", mode: "keyword" }),
    ).resolves.toEqual({
      mode: "keyword",
      results: [],
    });
    expect(calls).toEqual([
      { root: { rootPath: "/tmp/lorelum-client-test" }, request: { text: "search" } },
    ]);
  });

  test("propagates the caller trace without treating it as an authentication credential", async () => {
    const sink = new MemoryLogSink();
    const traceId = "00000000-0000-4000-8000-000000000026" as never;
    const { url } = runningApp(
      {
        async query() {
          return { mode: "keyword", results: [] };
        },
      },
      identity,
      undefined,
      createContentAddressedSemanticRuntimeStub(),
      new SinkLogEmitter(sink),
    );
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      traceId,
    });

    await expect(
      client.query(
        { rootPath: "/tmp/lorelum-client-trace" },
        { text: "trace me", mode: "keyword" },
      ),
    ).resolves.toEqual({ mode: "keyword", results: [] });
    expect(sink.records).toContainEqual(
      expect.objectContaining({
        message: "backend.request.completed",
        traceId,
        context: expect.objectContaining({ route: "query", method: "POST", status: 200 }),
      }),
    );
    expect(JSON.stringify(sink.records)).not.toContain(secret);
  });

  test("uses the authenticated request detail override without enabling debug for another trace", async () => {
    const sink = new MemoryLogSink();
    const traceId = "00000000-0000-4000-8000-000000000028" as never;
    const diagnostics = new TraceDetailLogEmitter("info", new SinkLogEmitter(sink));
    const { url } = runningApp(
      {
        async query(_root, _request, context) {
          context?.emitter?.emit({
            level: "debug",
            component: "engine",
            event: "query.debug-detail",
            traceId: context?.traceId,
            query: "selected debug query",
          });
          return { mode: "keyword", results: [] };
        },
      },
      identity,
      undefined,
      createContentAddressedSemanticRuntimeStub(),
      diagnostics,
    );
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      traceId,
      diagnosticLevel: "debug",
    });

    await expect(
      client.query(
        { rootPath: "/tmp/lorelum-client-debug" },
        { text: "trace me", mode: "keyword" },
      ),
    ).resolves.toEqual({ mode: "keyword", results: [] });
    expect(sink.records).toContainEqual(
      expect.objectContaining({
        message: "query.debug-detail",
        traceId,
        context: { query: "selected debug query" },
      }),
    );
  });

  test("does not send ordinary requests to a service with a different build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "different-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search", mode: "keyword" }),
    ).rejects.toEqual(expect.objectContaining({ code: "backend.build-mismatch" }));
    await expect(client.statusModel()).rejects.toEqual(
      expect.objectContaining({ code: "backend.build-mismatch" }),
    );
  });

  test("stops an authenticated service with a different build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "different-build",
      baseUrl: url,
    });

    await expect(client.stop()).resolves.toMatchObject({
      state: "stopping",
      instanceId: identity.instanceId,
      buildIdentity: identity.buildIdentity,
    });
  });

  test("preserves the established domain error code from a query response", async () => {
    const { url } = runningApp({
      async query() {
        throw new (await import("@lorelum/engine")).InvalidQueryRequestError();
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search", mode: "keyword" }),
    ).rejects.toBeInstanceOf(BackendRemoteError);
  });

  test("rejects non-loopback client URLs", () => {
    expect(() =>
      createBackendClient({
        identity,
        secret,
        buildIdentity: "test-build",
        baseUrl: "http://example.test",
      }),
    ).toThrow(TypeError);
    expect(() =>
      createBackendClient({
        identity,
        secret,
        buildIdentity: "test-build",
        baseUrl: "http://localhost:26186/query",
      }),
    ).toThrow(TypeError);
  });

  test("loads, reports, unloads, and embeds through the authenticated model contract", async () => {
    const calls: string[] = [];
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation() {
        return { preparationId: crypto.randomUUID(), status: this.status() };
      },
      modelPreparation(preparationId) {
        return { preparationId, status: this.status() };
      },
      async waitModelPreparation() {
        return this.status();
      },
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      beginLoad() {
        calls.push("load");
        return this.status();
      },
      embedQuery(inputs) {
        return this.embed("query", inputs);
      },
      async load() {
        return this.status();
      },
      async unload() {
        calls.push("unload");
        return { ...this.status(), state: "unloaded" };
      },
      async embed(kind, inputs) {
        calls.push(`${kind}:${inputs.length}`);
        return { encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });

    await expect(client.statusModel()).resolves.toMatchObject({ state: "ready" });
    await expect(client.loadModel()).resolves.toMatchObject({ state: "ready" });
    await expect(client.unloadModel()).resolves.toMatchObject({ state: "unloaded" });
    await expect(client.embed("query", ["hello"])).resolves.toMatchObject({
      encodingId: ENCODING_ID,
    });
    expect(calls).toEqual(["load", "unload", "query:1"]);
  });

  test("load polls asynchronous preparation beyond the native startup budget and maps failure", async () => {
    const phases: string[] = [];
    const resource = {
      kind: "native",
      file: "native/darwin-arm64/llama-server",
      check: "missing",
    } as const;
    const embedding = createEmbeddingService({
      settings: { ...DEFAULT_BACKEND_SETTINGS, startupTimeoutMs: 10 },
      prepareModel: async (_, progress) => {
        progress({ phase: "downloading", downloadedBytes: 10, totalBytes: 100 });
        await Bun.sleep(300);
        throw new EmbeddingError("embedding.native-resource-invalid", undefined, resource);
      },
      createRuntime: () => {
        throw new Error("download must finish first");
      },
    });
    const { url } = runningApp(undefined, identity, embedding);
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      timeoutMs: 1000,
    });
    await expect(
      client.loadModel({ onProgress: (value) => phases.push(value.progress!.phase) }),
    ).rejects.toMatchObject({ code: "embedding.native-resource-invalid", resource });
    await expect(client.beginModelPreparation()).rejects.toMatchObject({
      code: "embedding.native-resource-invalid",
      resource,
    });
    expect(phases).toContain("downloading");
    await expect(client.embed("query", Array(9).fill("x"))).rejects.toMatchObject({
      code: "embedding.input-invalid",
    });
  });

  test("uses shutdown timeout for model unload", async () => {
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation() {
        return { preparationId: crypto.randomUUID(), status: this.status() };
      },
      modelPreparation(preparationId) {
        return { preparationId, status: this.status() };
      },
      async waitModelPreparation() {
        return this.status();
      },
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      beginLoad() {
        return this.status();
      },
      embedQuery(inputs) {
        return this.embed("query", inputs);
      },
      async load() {
        return this.status();
      },
      async unload() {
        await Bun.sleep(100);
        return { ...this.status(), state: "unloaded" };
      },
      async embed() {
        return { encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      timeoutMs: 1_000,
      shutdownTimeoutMs: 10,
    });
    await expect(client.unloadModel()).rejects.toMatchObject({ code: "backend.deadline-exceeded" });
  });

  test("rejects an embedding response whose vector count differs from the input count", async () => {
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation() {
        return { preparationId: crypto.randomUUID(), status: this.status() };
      },
      modelPreparation(preparationId) {
        return { preparationId, status: this.status() };
      },
      async waitModelPreparation() {
        return this.status();
      },
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      beginLoad() {
        return this.status();
      },
      embedQuery(inputs) {
        return this.embed("query", inputs);
      },
      load: async () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      unload: async () => ({
        state: "unloaded",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      embed: async () => ({ encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] }),
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    await expect(client.embed("query", ["hello", "world"])).rejects.toMatchObject({
      code: "backend.failed",
    });
  });

  test("uses the authenticated semantic index operation contract", async () => {
    const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const traceId = "00000000-0000-4000-8000-000000000027" as never;
    const sink = new MemoryLogSink();
    const { url } = runningApp(
      undefined,
      identity,
      undefined,
      createContentAddressedSemanticRuntimeStub({
        async indexStatus() {
          return { state: "missing", profileId: "a".repeat(64) };
        },
        async build() {
          return { operationId, state: "building" };
        },
        async rebuild() {
          return { operationId, state: "building" };
        },
        async indexOperation() {
          return {
            operationId,
            state: "ready",
            index: { state: "ready", profileId: "a".repeat(64), vectorCount: 1 },
          };
        },
      }),
      new SinkLogEmitter(sink),
    );
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      traceId,
    });

    await expect(
      client.indexStatus({ rootPath: "/tmp/lorelum-index-client" }),
    ).resolves.toMatchObject({
      state: "missing",
    });
    await expect(client.buildIndex({ rootPath: "/tmp/lorelum-index-client" })).resolves.toEqual({
      operationId,
      state: "building",
    });
    await expect(client.indexOperation(operationId)).resolves.toMatchObject({
      state: "ready",
      index: { vectorCount: 1 },
    });
    expect(sink.records).toContainEqual(
      expect.objectContaining({
        message: "backend.request.completed",
        traceId,
        operationId,
        context: expect.objectContaining({ route: "index", method: "POST", status: 202 }),
      }),
    );
  });

  test("reports an index operation lost after a daemon restart as expired", async () => {
    const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const { url } = runningApp(
      undefined,
      identity,
      undefined,
      createContentAddressedSemanticRuntimeStub({
        async indexOperation() {
          return undefined;
        },
      }),
    );
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });

    await expect(client.indexOperation(operationId)).rejects.toMatchObject({
      code: "backend.operation-expired",
    });
  });

  test("uses the authenticated Practice-hint routes for shell windows and session reads", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "lorelum-practice-hint-client-")));
    try {
      const practiceHints = createPracticeHintService({
        sessionsDirectory: join(root, ".lorelum", "sessions"),
      });
      const { url } = runningApp(
        undefined,
        identity,
        undefined,
        undefined,
        undefined,
        practiceHints,
      );
      const client = createBackendClient({
        identity,
        secret,
        buildIdentity: identity.buildIdentity,
        baseUrl: url,
      });
      const cwd = join(root, "workspace");
      const event: ShellToolEvent = {
        hostKey: "codex",
        event: "pre",
        toolKind: "shell",
        sessionId: "client-test-session",
        toolUseId: "tool-1",
        cwd,
      };
      const hint: ReadHint = {
        id: "api.boundary",
        digest: "a".repeat(64),
        title: "Authenticated route fixture",
        appliesWhen: "When testing the Backend client contract",
      };
      const authority = new URL(url).host;

      const unauthorized = await fetch(`${url}/internal/v1/practice-hints/tool-events`, {
        method: "POST",
        headers: { host: authority, "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      expect(unauthorized.status).toBe(401);
      const unauthorizedRead = await fetch(
        `${url}/internal/v1/practice-hints/sessions?hostKey=codex&sessionId=client-test-session`,
        { headers: { host: authority } },
      );
      expect(unauthorizedRead.status).toBe(401);
      const unauthorizedSession = { hostKey: "codex", sessionId: "unauthorized-session" } as const;
      const unauthorizedGetReport = await fetch(`${url}/internal/v1/practice-hints/reads`, {
        method: "POST",
        headers: { host: authority, "content-type": "application/json" },
        body: JSON.stringify({ cwd, hint, session: unauthorizedSession }),
      });
      expect(unauthorizedGetReport.status).toBe(401);
      expect(
        await client.readRecentHints(unauthorizedSession.hostKey, unauthorizedSession.sessionId),
      ).toEqual([]);

      await client.routeToolEvent({ ...event, toolKind: "other" });
      await client.recordSuccessfulGet(cwd, hint);
      expect(await client.readRecentHints("codex", event.sessionId)).toEqual([]);

      const explicitSession = { hostKey: "codex", sessionId: "explicit-client-session" } as const;
      await client.recordSuccessfulGet(cwd, hint, explicitSession);
      expect(await client.readRecentHints("codex", explicitSession.sessionId)).toEqual([hint]);
      expect(await client.readRecentHints("codex", event.sessionId)).toEqual([]);

      await client.routeToolEvent(event);
      await client.recordSuccessfulGet(cwd, hint);
      expect(await client.readRecentHints("codex", event.sessionId)).toEqual([hint]);

      for (let index = 0; index < 300; index += 1) {
        // eslint-disable-next-line no-await-in-loop -- Populate a long session before testing the bounded HTTP read.
        await practiceHints.recordSuccessfulGet(cwd, {
          ...hint,
          id: `bulk-${index}`,
          title: "x".repeat(1_200),
        });
      }
      const recent = await client.readRecentHints("codex", event.sessionId);
      expect(recent).toHaveLength(100);
      expect(recent[0]?.id).toBe("bulk-299");
      expect(Buffer.byteLength(JSON.stringify(recent), "utf8")).toBeLessThanOrEqual(262_144);

      await client.routeToolEvent({ ...event, event: "post" });
      await client.recordSuccessfulGet(cwd, { ...hint, id: "after-post" });
      expect((await client.readRecentHints("codex", event.sessionId))[0]?.id).toBe("bulk-299");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("rejects a mismatched protocol before sending control or model requests", async () => {
  const mismatchedIdentity = { ...identity, protocolVersion: PROTOCOL_VERSION + 1 };
  const { url } = runningApp(undefined, mismatchedIdentity);
  const client = createBackendClient({
    identity: mismatchedIdentity,
    secret,
    buildIdentity: "test-build",
    baseUrl: url,
  });
  await expect(client.status()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
  await expect(client.stop()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
  await expect(client.loadModel()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
  await expect(client.beginModelPreparation()).rejects.toMatchObject({
    code: "backend.protocol-mismatch",
  });
});

test("round-trips semantic query metadata", async () => {
  const calls: unknown[] = [];
  const { url } = runningApp(
    undefined,
    identity,
    undefined,
    createContentAddressedSemanticRuntimeStub({
      async query(_root: StorageRoot, _target, request: QueryRequest) {
        calls.push(request);
        return {
          mode: "semantic",
          profileId: "b".repeat(64),
          coverage: "complete" as const,
          results: [],
        };
      },
    }),
  );
  const client = createBackendClient({
    identity,
    secret,
    buildIdentity: identity.buildIdentity,
    baseUrl: url,
  });

  await expect(
    client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "meaning" }),
  ).resolves.toEqual({
    mode: "semantic",
    profileId: "b".repeat(64),
    coverage: "complete",
    results: [],
  });
  expect(calls).toEqual([{ text: "meaning" }]);
});

test("preserves semantic index errors through the client boundary", async () => {
  const { url } = runningApp(
    undefined,
    identity,
    undefined,
    createContentAddressedSemanticRuntimeStub({
      async query() {
        throw new (await import("@lorelum/engine")).SemanticIndexNotReadyError();
      },
    }),
  );
  const client = createBackendClient({
    identity,
    secret,
    buildIdentity: identity.buildIdentity,
    baseUrl: url,
  });

  await expect(
    client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "meaning" }),
  ).rejects.toMatchObject({ code: "semantic.index-not-ready" });
});
