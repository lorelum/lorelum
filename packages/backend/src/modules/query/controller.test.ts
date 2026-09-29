import { expect, test } from "bun:test";
import { InvalidQueryRequestError, SemanticIndexNotReadyError } from "@lorelum/engine";
import { MemoryLogSink, SinkLogEmitter } from "@lorelum/log";

import { createBackendApp } from "../../app";
import { createBackendService } from "../backend/service";
import { EmbeddingError } from "../embedding/errors";
import type { QueryService } from "@lorelum/engine";
import type { ContentAddressedSemanticRuntimePort } from "./content-addressed-semantic-runtime";
import { createContentAddressedSemanticRuntimeStub } from "./content-addressed-semantic-runtime.test-helper";
import { PROTOCOL_VERSION } from "../../protocol/constants";

const secret = "query-controller-test-secret";
const identity = {
  instanceId: "query-controller-test",
  buildIdentity: "query-controller-build",
  protocolVersion: PROTOCOL_VERSION,
} as const;

function request(body: unknown): Request {
  return new Request("http://127.0.0.1/internal/v1/query", {
    method: "POST",
    headers: {
      host: "127.0.0.1:26186",
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function app(
  keywordQueryService: QueryService,
  semanticRuntime: ContentAddressedSemanticRuntimePort,
  diagnostics?: SinkLogEmitter,
) {
  return createBackendApp({
    backend: createBackendService({ identity, secret, onStop: () => undefined }),
    keywordQueryService,
    semanticRuntime,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

test("defaults query mode to semantic and preserves semantic result metadata", async () => {
  const calls: string[] = [];
  const instance = app(
    {
      async query() {
        throw new Error("keyword facade must not be selected");
      },
    },
    createContentAddressedSemanticRuntimeStub({
      async query(root, _target, query) {
        calls.push(`${root.rootPath}:${query.text}`);
        return {
          mode: "semantic",
          profileId: "a".repeat(64),
          coverage: "partial",
          results: [],
        };
      },
    }),
  );

  const response = await instance.handle(
    request({ storageRoot: "/tmp/query-controller", query: { text: "deployment" } }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    mode: "semantic",
    profileId: "a".repeat(64),
    coverage: "partial",
    results: [],
  });
  expect(calls).toEqual(["/tmp/query-controller:deployment"]);
});

test("records one trace's declared query evidence without serializing request credentials", async () => {
  const sink = new MemoryLogSink();
  const traceId = "00000000-0000-4000-8000-000000000001" as never;
  const instance = app(
    {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    createContentAddressedSemanticRuntimeStub(),
    new SinkLogEmitter(sink),
  );
  const response = await instance.handle(
    new Request("http://127.0.0.1/internal/v1/query", {
      method: "POST",
      headers: {
        host: "127.0.0.1:26186",
        authorization: `Bearer ${secret}`,
        cookie: "session=must-not-serialize",
        "content-type": "application/json",
        "x-lorelum-trace-id": traceId,
      },
      body: JSON.stringify({ storageRoot: "/tmp/query-controller", query: { text: "keep raw" } }),
    }),
  );
  expect(response.status).toBe(200);
  expect(sink.records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: "backend.request.started",
        traceId,
        context: expect.objectContaining({ route: "query", query: "keep raw" }),
      }),
      expect.objectContaining({ message: "trace.request.accepted", traceId }),
      expect.objectContaining({
        message: "backend.request.completed",
        traceId,
        context: expect.objectContaining({ route: "query", method: "POST", status: 200 }),
      }),
    ]),
  );
  expect(JSON.stringify(sink.records)).not.toContain("must-not-serialize");
  expect(JSON.stringify(sink.records)).not.toContain(secret);
});

test("records a controlled failure outcome while withholding credential-like error text", async () => {
  const sink = new MemoryLogSink();
  const traceId = "00000000-0000-4000-8000-000000000014" as never;
  const instance = app(
    {
      async query() {
        throw new Error("Bearer must-not-serialize");
      },
    },
    createContentAddressedSemanticRuntimeStub(),
    new SinkLogEmitter(sink),
  );
  const response = await instance.handle(
    new Request("http://127.0.0.1/internal/v1/query", {
      method: "POST",
      headers: {
        host: "127.0.0.1:26186",
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-lorelum-trace-id": traceId,
      },
      body: JSON.stringify({
        storageRoot: "/tmp/query-controller",
        query: { text: "failing keyword", mode: "keyword" },
      }),
    }),
  );
  expect(response.status).toBe(500);
  expect(sink.records).toContainEqual(
    expect.objectContaining({
      message: "backend.request.failed",
      traceId,
      context: expect.objectContaining({
        route: "query",
        method: "POST",
        status: 500,
        code: "backend.failed",
      }),
    }),
  );
  expect(JSON.stringify(sink.records)).not.toContain("must-not-serialize");
});

test("explicit keyword mode selects only the keyword facade", async () => {
  const calls: string[] = [];
  const instance = app(
    {
      async query(_root, query) {
        calls.push(query.text);
        return { mode: "keyword", results: [] };
      },
    },
    createContentAddressedSemanticRuntimeStub({
      async query() {
        throw new Error("semantic facade must not be selected");
      },
    }),
  );

  const response = await instance.handle(
    request({
      storageRoot: "/tmp/query-controller",
      query: { text: "deployment", mode: "keyword" },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ mode: "keyword", results: [] });
  expect(calls).toEqual(["deployment"]);
});

test("maps semantic index readiness failures to a typed remote error", async () => {
  const instance = app(
    {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    createContentAddressedSemanticRuntimeStub({
      async query() {
        throw new SemanticIndexNotReadyError();
      },
    }),
  );
  const response = await instance.handle(
    request({ storageRoot: "/tmp/query-controller", query: { text: "deployment" } }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "semantic.index-not-ready" } });
});

test("maps a terminal embedding failure and preserves structured resource details", async () => {
  const resource = {
    kind: "native",
    file: "native/darwin-arm64/llama-server",
    check: "missing",
  } as const;
  const instance = app(
    {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    createContentAddressedSemanticRuntimeStub({
      async query() {
        throw new EmbeddingError("embedding.native-resource-invalid", undefined, resource);
      },
    }),
  );
  const response = await instance.handle(
    request({ storageRoot: "/tmp/query-controller", query: { text: "deployment" } }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: { code: "embedding.native-resource-invalid", resource },
  });
});

test("maps invalid Engine input before exposing an implementation failure", async () => {
  const instance = app(
    {
      async query() {
        throw new InvalidQueryRequestError();
      },
    },
    createContentAddressedSemanticRuntimeStub({
      async query() {
        return { mode: "semantic", profileId: "a".repeat(64), coverage: "complete", results: [] };
      },
    }),
  );
  const response = await instance.handle(
    request({
      storageRoot: "/tmp/query-controller",
      query: { text: "deployment", mode: "keyword" },
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "usage.invalid" } });
});

test("uses the project runtime for partial and indexing query results", async () => {
  const calls: unknown[] = [];
  const runtime: ContentAddressedSemanticRuntimePort = {
    async query(root, context, query) {
      calls.push({ root, context, query });
      return {
        mode: "semantic",
        profileId: "a".repeat(64),
        coverage: "partial",
        indexedPracticeCount: 1,
        totalPracticeCount: 2,
        operationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        results: [],
      };
    },
    async indexStatus() {
      return { state: "missing", profileId: "a".repeat(64) };
    },
    async build() {
      return { operationId: crypto.randomUUID(), state: "building" };
    },
    async rebuild() {
      return { operationId: crypto.randomUUID(), state: "building" };
    },
    async indexOperation() {
      return undefined;
    },
    async waitForIdle() {},
  };
  const instance = app(
    {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    runtime,
  );
  const response = await instance.handle(
    request({
      storageRoot: "/tmp/query-controller",
      query: {
        text: "deployment",
        projectContext: { projectRoot: "/tmp/project", cacheRoot: "/tmp/cache" },
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    mode: "semantic",
    coverage: "partial",
    indexedPracticeCount: 1,
    totalPracticeCount: 2,
  });
  expect(calls).toEqual([
    {
      root: { rootPath: "/tmp/query-controller" },
      context: { kind: "project", projectRoot: "/tmp/project", cacheRoot: "/tmp/cache" },
      query: { text: "deployment" },
    },
  ]);
});

test("uses the Store target runtime whenever semantic query supplies a cache root", async () => {
  const calls: unknown[] = [];
  const runtime: ContentAddressedSemanticRuntimePort = {
    async query(root, target, query, policy) {
      calls.push({ root, target, query, policy });
      return {
        state: "indexing",
        operationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        indexedPracticeCount: 50,
        totalPracticeCount: 100,
      };
    },
    async indexStatus() {
      return { state: "missing", profileId: "a".repeat(64) };
    },
    async build() {
      return { operationId: crypto.randomUUID(), state: "building" };
    },
    async rebuild() {
      return { operationId: crypto.randomUUID(), state: "building" };
    },
    async indexOperation() {
      return undefined;
    },
    async waitForIdle() {},
  };
  const instance = app(
    {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    runtime,
  );
  const response = await instance.handle(
    request({
      storageRoot: "/tmp/query-controller",
      query: {
        text: "deployment",
        cacheRoot: "/tmp/query-cache",
        maxWaitMs: 5000,
        minCoveragePercent: 80,
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    state: "indexing",
    indexedPracticeCount: 50,
    totalPracticeCount: 100,
  });
  expect(calls).toEqual([
    {
      root: { rootPath: "/tmp/query-controller" },
      target: { kind: "store", cacheRoot: "/tmp/query-cache" },
      query: { text: "deployment" },
      policy: { maxWaitMs: 5000, minCoveragePercent: 80 },
    },
  ]);
});
