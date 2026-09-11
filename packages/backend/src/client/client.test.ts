import { afterEach, describe, expect, test } from "bun:test";

import type { QueryService } from "@lorelum/engine";

import { createBackendApp } from "../app";
import type { EmbeddingService } from "../modules/embedding/service";
import { createBackendService } from "../modules/backend/service";
import type { InstanceIdentity } from "../protocol/identity";
import { BackendRemoteError } from "../protocol/errors";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL, ENCODING_ID } from "../modules/embedding/model";
import { BUSINESS_VERSION, CONTROL_VERSION } from "../protocol/constants";
import { createBackendClient } from "./client";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  controlVersion: CONTROL_VERSION,
  businessVersion: BUSINESS_VERSION,
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
): {
  readonly app: ReturnType<typeof createBackendApp>;
  readonly url: string;
} {
  const app = createBackendApp({
    backend: createBackendService({ identity: backendIdentity, secret, onStop: () => undefined }),
    ...(embedding === undefined ? {} : { embedding }),
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

  test("allows a compatible control client to stop an older build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "newer-build",
      baseUrl: url,
    });

    await expect(client.status()).resolves.toMatchObject({ state: "ready" });
    await expect(client.stop()).resolves.toMatchObject({ state: "stopping" });
  });

  test("does not send a query to a service with a different business build", async () => {
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

  test("allows control operations but rejects queries against an older business protocol", async () => {
    const { url } = runningApp(undefined, { ...identity, businessVersion: 0 });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(client.status()).resolves.toMatchObject({ state: "ready" });
    await expect(client.stop()).resolves.toMatchObject({ state: "stopping" });
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
      }),
      async load() {
        calls.push("load");
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

  test("uses startup timeout for model load and maps embedding errors", async () => {
    const { url } = runningApp(undefined, identity, {
      status: () => ({
        state: "unloaded",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
      }),
      async load() {
        await Bun.sleep(100);
        throw new EmbeddingError("embedding.failed");
      },
      async unload() {
        throw new EmbeddingError("embedding.not-loaded");
      },
      async embed() {
        throw new EmbeddingError("embedding.not-loaded");
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      timeoutMs: 1_000,
      startupTimeoutMs: 10,
    });
    await expect(client.loadModel()).rejects.toMatchObject({ code: "backend.deadline-exceeded" });
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
      }),
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

  test("requires the current business protocol for model operations", async () => {
    const { url } = runningApp(undefined, { ...identity, businessVersion: BUSINESS_VERSION - 1 });
    const client = createBackendClient({
      identity: { ...identity, businessVersion: BUSINESS_VERSION - 1 },
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    await expect(client.statusModel()).rejects.toEqual(
      expect.objectContaining({
        code: "backend.incompatible",
      }),
    );
  });

  test("rejects an embedding response whose vector count differs from the input count", async () => {
    const { url } = runningApp(undefined, identity, {
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
      }),
      load: async () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
      }),
      unload: async () => ({
        state: "unloaded",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
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
});

test("protocol version 2 does not control a version 1 daemon", async () => {
  const oldIdentity = { ...identity, controlVersion: 1, businessVersion: 1 };
  const { url } = runningApp(undefined, oldIdentity);
  const client = createBackendClient({
    identity: oldIdentity,
    secret,
    buildIdentity: "test-build",
    baseUrl: url,
  });
  await expect(client.status()).rejects.toMatchObject({ code: "backend.incompatible" });
  await expect(client.stop()).rejects.toMatchObject({ code: "backend.incompatible" });
  await expect(client.loadModel()).rejects.toMatchObject({ code: "backend.incompatible" });
});
