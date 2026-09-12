import { expect, test } from "bun:test";

import type { QueryService } from "@lorelum/engine";

import { createBackendApp } from "../../app";
import { createBackendService } from "../backend/service";
import { EmbeddingError } from "../embedding/errors";
import { StoreBusyError } from "@lorelum/engine";
import type { IndexOperationService } from "./operation-service";

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

function app(indexOperations: IndexOperationService) {
  const queryService: QueryService = {
    async query() {
      return { mode: "keyword", results: [] };
    },
  };
  return createBackendApp({
    backend: createBackendService({ identity, secret, onStop: () => undefined }),
    queryService,
    indexOperations,
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
