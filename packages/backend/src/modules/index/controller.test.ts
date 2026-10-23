import { expect, test } from "bun:test";
import { MemoryLogSink, SinkLogEmitter } from "@lorelum/log";

import type { QueryService, StorageRoot } from "@lorelum/engine";

import { createBackendApp } from "../../app";
import { createBackendService } from "../backend/service";
import { EmbeddingError } from "../embedding/errors";
import { StoreBusyError } from "@lorelum/engine";
import type { ContentAddressedSemanticRuntimePort } from "../query/content-addressed-semantic-runtime";
import { createContentAddressedSemanticRuntimeStub } from "../query/content-addressed-semantic-runtime.test-helper";
import type { IndexOperation, IndexStatus } from "./model";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  protocolVersion: 1,
});
const secret = "index-controller-test-secret";
const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const profileId = "a".repeat(64);

interface IndexOperationStub {
  status(root: StorageRoot): Promise<IndexStatus>;
  build(root: StorageRoot): IndexOperation;
  rebuild(root: StorageRoot): IndexOperation;
  operation(operationId: string): IndexOperation | undefined;
  waitForIdle(deadline?: number): Promise<void>;
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: { host: "127.0.0.1:26186", authorization: `Bearer ${secret}`, ...init.headers },
  });
}

function app(
  indexOperations: IndexOperationStub,
  semanticRuntime?: ContentAddressedSemanticRuntimePort,
  diagnostics?: SinkLogEmitter,
) {
  const keywordQueryService: QueryService = {
    async query() {
      return { mode: "keyword", results: [] };
    },
  };
  const runtime =
    semanticRuntime ??
    createContentAddressedSemanticRuntimeStub({
      async indexStatus(root) {
        return indexOperations.status(root);
      },
      async build(root) {
        return indexOperations.build(root);
      },
      async rebuild(root) {
        return indexOperations.rebuild(root);
      },
      async indexOperation(requestedOperationId) {
        return indexOperations.operation(requestedOperationId);
      },
      async waitForIdle(deadline) {
        await indexOperations.waitForIdle(deadline);
      },
    });
  return createBackendApp({
    backend: createBackendService({
      identity,
      build: {
        toolVersion: "test-version",
        revision: null,
        dirty: null,
        buildKind: "source",
        buildIdentity: identity.buildIdentity,
      },
      secret,
      onStop: () => undefined,
    }),
    keywordQueryService,
    semanticRuntime: runtime,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

test("index status is authenticated and does not start an index operation", async () => {
  let statusCalls = 0;
  const instance = app({
    async status(root) {
      statusCalls++;
      expect(root).toEqual({ rootPath: "/tmp/index-controller" });
      return { state: "missing", profileId };
    },
    build() {
      throw new Error("must not build");
    },
    rebuild() {
      throw new Error("must not rebuild");
    },
    operation() {
      return undefined;
    },
    waitForIdle: async () => undefined,
  });

  const response = await instance.handle(
    request("/internal/v1/index/status?storageRoot=/tmp/index-controller"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "missing", profileId });
  expect(statusCalls).toBe(1);
});

test("records accepted build and rebuild operation relations for the requesting trace", async () => {
  const sink = new MemoryLogSink();
  const traceId = "00000000-0000-4000-8000-000000000002" as never;
  const instance = app(
    {
      status: async () => ({ state: "missing", profileId }),
      build: () => ({ operationId, state: "building" }),
      rebuild: () => ({ operationId, state: "building" }),
      operation: () => undefined,
      waitForIdle: async () => undefined,
    },
    undefined,
    new SinkLogEmitter(sink),
  );
  const responses = await Promise.all(
    (["build", "rebuild"] as const).map((route) =>
      instance.handle(
        request(`/internal/v1/index/${route}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lorelum-trace-id": traceId,
          },
          body: JSON.stringify({ storageRoot: "/tmp/index-controller" }),
        }),
      ),
    ),
  );
  expect(responses.map((response) => response.status)).toEqual([202, 202]);
  expect(sink.records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: "trace.request.accepted", traceId }),
      expect.objectContaining({ message: "trace.operation.accepted", traceId, operationId }),
      expect.objectContaining({
        message: "backend.request.completed",
        traceId,
        operationId,
        context: expect.objectContaining({ route: "index", method: "POST", status: 202 }),
      }),
    ]),
  );
});

test("build returns an accepted operation and operation reads are bounded", async () => {
  const instance = app({
    status: async () => ({ state: "missing", profileId }),
    build: () => ({ operationId, state: "building" }),
    rebuild: () => ({ operationId, state: "building" }),
    operation: (id) =>
      id === operationId
        ? { operationId, state: "ready", index: { state: "ready", profileId, vectorCount: 1 } }
        : undefined,
    waitForIdle: async () => undefined,
  });
  const headers = { "content-type": "application/json" };
  const accepted = await instance.handle(
    request("/internal/v1/index/build", {
      method: "POST",
      headers,
      body: JSON.stringify({ storageRoot: "/tmp/index-controller" }),
    }),
  );
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toEqual({ operationId, state: "building" });

  const completed = await instance.handle(request(`/internal/v1/index/operations/${operationId}`));
  expect(completed.status).toBe(200);
  expect(await completed.json()).toEqual({
    operationId,
    state: "ready",
    index: { state: "ready", profileId, vectorCount: 1 },
  });
  expect((await instance.handle(request("/internal/v1/index/operations/not-a-uuid"))).status).toBe(
    400,
  );

  const expired = await instance.handle(
    request("/internal/v1/index/operations/1f8fad5b-d9cb-469f-a165-70867728950e"),
  );
  expect(expired.status).toBe(410);
  expect(await expired.json()).toEqual({
    error: {
      code: "backend.operation-expired",
      message: "The semantic index operation is no longer available in this backend instance.",
    },
  });
});

test("operation reads expose an accepted model-preparing continuation", async () => {
  const preparationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const instance = app({
    status: async () => ({ state: "missing", profileId }),
    build: () => ({ operationId, state: "building" }),
    rebuild: () => ({ operationId, state: "building" }),
    operation: (id) =>
      id === operationId ? { operationId, state: "preparing", preparationId } : undefined,
    waitForIdle: async () => undefined,
  });

  const response = await instance.handle(request(`/internal/v1/index/operations/${operationId}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    operationId,
    state: "preparing",
    preparationId,
  });
});

test("build preserves an explicit model-readiness failure", async () => {
  const instance = app({
    status: async () => ({ state: "missing", profileId }),
    build: () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
    rebuild: () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
    operation: () => undefined,
    waitForIdle: async () => undefined,
  });
  const response = await instance.handle(
    request("/internal/v1/index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storageRoot: "/tmp/index-controller" }),
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: {
      code: "embedding.not-loaded",
      message: "Load the embedding model before encoding text.",
    },
  });
});

test("status preserves Store availability errors", async () => {
  const instance = app({
    status: async () => {
      throw new StoreBusyError("Store mutation is in progress");
    },
    build: () => ({ operationId, state: "building" }),
    rebuild: () => ({ operationId, state: "building" }),
    operation: () => undefined,
    waitForIdle: async () => undefined,
  });
  const response = await instance.handle(
    request("/internal/v1/index/status?storageRoot=/tmp/index-controller"),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { code: "store.busy", message: "The local Pack store is busy." },
  });
});

test("project index routes use the supplied context without changing the Store selection", async () => {
  const projectRoot = "/tmp/project-index-controller";
  const cacheRoot = "/tmp/project-index-cache";
  const calls: unknown[] = [];
  const instance = app(
    {
      status: async () => {
        throw new Error("Store route must not be used for ProjectContext");
      },
      build: () => {
        throw new Error("Store route must not be used for ProjectContext");
      },
      rebuild: () => {
        throw new Error("Store route must not be used for ProjectContext");
      },
      operation: () => undefined,
      waitForIdle: async () => undefined,
    },
    {
      async indexStatus(root, target) {
        calls.push(["status", root, target]);
        return {
          state: "indexing",
          profileId,
          operationId,
          indexedPracticeCount: 50,
          totalPracticeCount: 100,
        };
      },
      async build(root, target) {
        calls.push(["build", root, target]);
        return {
          operationId,
          state: "queued",
          indexedPracticeCount: 0,
          totalPracticeCount: 100,
        };
      },
      async rebuild(root, target) {
        calls.push(["rebuild", root, target]);
        return {
          operationId,
          state: "queued",
          indexedPracticeCount: 0,
          totalPracticeCount: 100,
        };
      },
      async indexOperation() {
        return undefined;
      },
      async query() {
        throw new Error("query is outside this index-controller test");
      },
      async waitForIdle() {},
    },
  );

  const statusResponse = await instance.handle(
    request(
      `/internal/v1/index/status?storageRoot=/tmp/index-controller&projectRoot=${encodeURIComponent(projectRoot)}&cacheRoot=${encodeURIComponent(cacheRoot)}`,
    ),
  );
  expect(statusResponse.status).toBe(200);
  expect(await statusResponse.json()).toEqual({
    state: "indexing",
    profileId,
    operationId,
    indexedPracticeCount: 50,
    totalPracticeCount: 100,
  });

  const buildResponse = await instance.handle(
    request("/internal/v1/index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storageRoot: "/tmp/index-controller",
        projectContext: { projectRoot, cacheRoot },
      }),
    }),
  );
  expect(buildResponse.status).toBe(202);
  expect(await buildResponse.json()).toEqual({
    operationId,
    state: "queued",
    indexedPracticeCount: 0,
    totalPracticeCount: 100,
  });
  expect(calls).toEqual([
    [
      "status",
      { rootPath: "/tmp/index-controller" },
      { kind: "project", projectRoot, cacheRoot, retrievalMethod: "single-vector" },
    ],
    [
      "build",
      { rootPath: "/tmp/index-controller" },
      { kind: "project", projectRoot, cacheRoot, retrievalMethod: "single-vector" },
    ],
  ]);
});

test("Store cache routes use the common target runtime", async () => {
  const calls: unknown[] = [];
  const instance = app(
    {
      async status() {
        throw new Error("legacy Store status must not run");
      },
      build() {
        throw new Error("legacy Store build must not run");
      },
      rebuild() {
        throw new Error("legacy Store rebuild must not run");
      },
      operation() {
        return undefined;
      },
      waitForIdle: async () => undefined,
    },
    {
      async indexStatus(root, target) {
        calls.push(["status", root, target]);
        return {
          state: "indexing",
          profileId,
          operationId,
          indexedPracticeCount: 50,
          totalPracticeCount: 100,
        };
      },
      async build(root, target) {
        calls.push(["build", root, target]);
        return { operationId, state: "queued", indexedPracticeCount: 0, totalPracticeCount: 100 };
      },
      async rebuild() {
        throw new Error("unexpected rebuild");
      },
      async indexOperation() {
        return undefined;
      },
      async query() {
        throw new Error("query is outside this index-controller test");
      },
      async waitForIdle() {},
    },
  );
  const statusResponse = await instance.handle(
    request(
      "/internal/v1/index/status?storageRoot=/tmp/index-controller&cacheRoot=/tmp/index-cache",
    ),
  );
  expect(statusResponse.status).toBe(200);
  const buildResponse = await instance.handle(
    request("/internal/v1/index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storageRoot: "/tmp/index-controller", cacheRoot: "/tmp/index-cache" }),
    }),
  );
  expect(buildResponse.status).toBe(202);
  expect(calls).toEqual([
    [
      "status",
      { rootPath: "/tmp/index-controller" },
      { kind: "store", cacheRoot: "/tmp/index-cache", retrievalMethod: "single-vector" },
    ],
    [
      "build",
      { rootPath: "/tmp/index-controller" },
      { kind: "store", cacheRoot: "/tmp/index-cache", retrievalMethod: "single-vector" },
    ],
  ]);
});

test("index routes default to single-vector and validate exact method IDs before accepting operations", async () => {
  const calls: unknown[] = [];
  const instance = app(
    {
      status: async () => ({ state: "missing", profileId }),
      build: () => ({ operationId, state: "queued" }),
      rebuild: () => ({ operationId, state: "queued" }),
      operation: () => undefined,
      waitForIdle: async () => undefined,
    },
    createContentAddressedSemanticRuntimeStub({
      async indexStatus(_root, target) {
        calls.push(["status", target.retrievalMethod]);
        return { state: "missing", profileId };
      },
      async build(_root, target) {
        calls.push(["build", target.retrievalMethod]);
        return { operationId, state: "queued" };
      },
      async rebuild(_root, target) {
        calls.push(["rebuild", target.retrievalMethod]);
        return { operationId, state: "queued" };
      },
    }),
  );
  for (const retrievalMethod of [undefined, "single-vector", "multi-view-vector"]) {
    const suffix = retrievalMethod === undefined ? "" : `&retrievalMethod=${retrievalMethod}`;
    const status = await instance.handle(
      request(`/internal/v1/index/status?storageRoot=/tmp/method-index${suffix}`),
    );
    expect(status.status).toBe(200);
    for (const route of ["build", "rebuild"]) {
      const response = await instance.handle(
        request(`/internal/v1/index/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            storageRoot: "/tmp/method-index",
            ...(retrievalMethod === undefined ? {} : { retrievalMethod }),
          }),
        }),
      );
      expect(response.status).toBe(202);
    }
  }
  expect(calls).toEqual(
    ["single-vector", "single-vector", "multi-view-vector"].flatMap((method) =>
      ["status", "build", "rebuild"].map((route) => [route, method]),
    ),
  );
  for (const retrievalMethod of ["simple", "multi-view", "multiview", null, 1, false, {}]) {
    for (const route of ["build", "rebuild"]) {
      const response = await instance.handle(
        request(`/internal/v1/index/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storageRoot: "/tmp/method-index", retrievalMethod }),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "usage.invalid" } });
    }
    const status = await instance.handle(
      request(
        `/internal/v1/index/status?storageRoot=/tmp/method-index&retrievalMethod=${encodeURIComponent(String(retrievalMethod))}`,
      ),
    );
    expect(status.status).toBe(400);
    expect(await status.json()).toMatchObject({ error: { code: "usage.invalid" } });
  }
  expect(calls).toHaveLength(9);
});
