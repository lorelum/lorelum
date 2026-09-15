import { expect, test } from "bun:test";

import type { QueryService, SemanticQueryService } from "@lorelum/engine";

import { createBackendApp } from "../../app";
import { createBackendService } from "../backend/service";
import { EmbeddingError } from "../embedding/errors";
import { StoreBusyError } from "@lorelum/engine";
import type { IndexOperationService } from "./operation-service";
import type {
  ProjectSemanticIndexRuntimePort,
  StoreSemanticIndexRuntimePort,
} from "../query/project-semantic-runtime";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  protocolVersion: 1,
});
const secret = "index-controller-test-secret";
const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const profileId = "a".repeat(64);

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: { host: "127.0.0.1:26186", authorization: `Bearer ${secret}`, ...init.headers },
  });
}

function app(
  indexOperations: IndexOperationService,
  projectRuntime?: ProjectSemanticIndexRuntimePort,
  storeRuntime?: StoreSemanticIndexRuntimePort,
) {
  const keywordQueryService: QueryService = {
    async query() {
      return { mode: "keyword", results: [] };
    },
  };
  const semanticQueryService: SemanticQueryService = {
    async query() {
      return { mode: "semantic", profileId, coverage: "complete", results: [] };
    },
  };
  return createBackendApp({
    backend: createBackendService({ identity, secret, onStop: () => undefined }),
    keywordQueryService,
    semanticQueryService,
    indexOperations,
    ...(projectRuntime === undefined ? {} : { projectSemanticIndexRuntime: projectRuntime }),
    ...(storeRuntime === undefined ? {} : { storeSemanticIndexRuntime: storeRuntime }),
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
      async indexStatus(root, request) {
        calls.push(["status", root, request]);
        return {
          state: "indexing",
          profileId,
          operationId,
          indexedPracticeCount: 50,
          totalPracticeCount: 100,
        };
      },
      async buildIndex(root, request) {
        calls.push(["build", root, request]);
        return {
          operationId,
          state: "queued",
          indexedPracticeCount: 0,
          totalPracticeCount: 100,
        };
      },
      async rebuildIndex(root, request) {
        calls.push(["rebuild", root, request]);
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
    ["status", { rootPath: "/tmp/index-controller" }, { projectRoot, cacheRoot }],
    ["build", { rootPath: "/tmp/index-controller" }, { projectRoot, cacheRoot }],
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
    undefined,
    {
      async indexStatusStore(root, request) {
        calls.push(["status", root, request]);
        return {
          state: "indexing",
          profileId,
          operationId,
          indexedPracticeCount: 50,
          totalPracticeCount: 100,
        };
      },
      async buildStoreIndex(root, request) {
        calls.push(["build", root, request]);
        return { operationId, state: "queued", indexedPracticeCount: 0, totalPracticeCount: 100 };
      },
      async rebuildStoreIndex() {
        throw new Error("unexpected rebuild");
      },
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
    ["status", { rootPath: "/tmp/index-controller" }, { cacheRoot: "/tmp/index-cache" }],
    ["build", { rootPath: "/tmp/index-controller" }, { cacheRoot: "/tmp/index-cache" }],
  ]);
});
