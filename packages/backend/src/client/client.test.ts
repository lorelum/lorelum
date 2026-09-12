import { afterEach, describe, expect, test } from "bun:test";

import type { QueryService } from "@lorelum/engine";

import { createBackendApp } from "../app";
import { createEmbeddingService, type EmbeddingService } from "../modules/embedding/service";
import { createBackendService } from "../modules/backend/service";
import type { IndexOperationService } from "../modules/index/operation-service";
import type { InstanceIdentity } from "../protocol/identity";
import { BackendRemoteError } from "../protocol/errors";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL, ENCODING_ID } from "../modules/embedding/model";
import { PROTOCOL_VERSION } from "../protocol/constants";
import { DEFAULT_BACKEND_SETTINGS } from "../config/model";
import { createBackendClient } from "./client";

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
  queryService?: QueryService,
  backendIdentity: InstanceIdentity = identity,
  embedding?: EmbeddingService,
  indexOperations?: IndexOperationService,
): {
  readonly app: ReturnType<typeof createBackendApp>;
  readonly url: string;
} {
  const app = createBackendApp({
    backend: createBackendService({ identity: backendIdentity, secret, onStop: () => undefined }),
    ...(embedding === undefined ? {} : { embedding }),
    ...(indexOperations === undefined ? {} : { indexOperations }),
    queryService: queryService ?? {
      async query() {
        return { mode: "keyword", results: [] } as const;
      },
    },
  });
  apps.push(app);
  app.listen({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 65_536 });
  if (app.server === null) throw new Error("test server did not start");
  return { app, url: `http://127.0.0.1:${app.server.port}` };
}

describe("createBackendClient", () => {
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
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
    ).resolves.toEqual({
      mode: "keyword",
      results: [],
    });
    expect(calls).toEqual([
      { root: { rootPath: "/tmp/lorelum-client-test" }, request: { text: "search" } },
    ]);
  });

  test("does not send a query to a service with a different build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "different-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
    ).rejects.toEqual(expect.objectContaining({ code: "backend.incompatible" }));
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
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
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
    const embedding = createEmbeddingService({
      settings: { ...DEFAULT_BACKEND_SETTINGS, startupTimeoutMs: 10 },
      prepareModel: async (_, progress) => {
        progress({ phase: "downloading", downloadedBytes: 10, totalBytes: 100 });
        await Bun.sleep(300);
        throw new EmbeddingError("embedding.download-failed");
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
    ).rejects.toMatchObject({ code: "embedding.download-failed" });
    expect(phases).toContain("downloading");
    await expect(client.embed("query", Array(9).fill("x"))).rejects.toMatchObject({
      code: "embedding.input-invalid",
    });
  });

  test("uses shutdown timeout for model unload", async () => {
    const { url } = runningApp(undefined, identity, {
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
    const indexOperations: IndexOperationService = {
      status: async () => ({ state: "missing", profileId: "a".repeat(64) }),
      build: () => ({ operationId, state: "building" }),
      rebuild: () => ({ operationId, state: "building" }),
      operation: () => ({
        operationId,
        state: "ready",
        index: { state: "ready", profileId: "a".repeat(64), vectorCount: 1 },
      }),
      waitForIdle: async () => undefined,
    };
    const { url } = runningApp(undefined, identity, undefined, indexOperations);
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
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
  await expect(client.status()).rejects.toMatchObject({ code: "backend.incompatible" });
  await expect(client.stop()).rejects.toMatchObject({ code: "backend.incompatible" });
  await expect(client.loadModel()).rejects.toMatchObject({ code: "backend.incompatible" });
});
