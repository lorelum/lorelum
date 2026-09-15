/* eslint-disable no-await-in-loop -- Failure matrix checks each isolated scenario independently. */
import { expect, test } from "bun:test";
import { createBackendRuntimeCoordinator } from "./coordinator";
import { createIndexRuntimeClient } from "./index-runtime-client";
import type { BackendClient } from "../client/client";
import type { BackendQueryResult } from "../modules/query/model";
import { createBackendClient } from "../client/client";
import { BackendError } from "../protocol/errors";
import { PROTOCOL_VERSION } from "../protocol/constants";

const empty: BackendQueryResult = {
  mode: "semantic",
  profileId: "a".repeat(64),
  coverage: "complete",
  results: [],
};
const root = { rootPath: "/isolated-test-store" };
function client(overrides: Partial<BackendClient> = {}): BackendClient {
  return {
    ...createBackendClient({
      identity: { instanceId: "test", buildIdentity: "test", protocolVersion: PROTOCOL_VERSION },
      secret: "test",
      buildIdentity: "test",
    }),
    identity: async () => ({
      instanceId: "test",
      buildIdentity: "test",
      protocolVersion: PROTOCOL_VERSION,
      proof: "a".repeat(64),
    }),
    query: async () => empty,
    ...overrides,
  };
}

test("pre-cancelled caller never connects or starts", async () => {
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => {
      throw new Error("must not connect");
    },
    start: async () => {
      throw new Error("must not start");
    },
  });
  const abort = new AbortController();
  abort.abort(new Error("cancelled"));
  await expect(coordinator.connect({ signal: abort.signal })).rejects.toThrow("cancelled");
});

test("caller cancellation stops startup wait without stopping shared startup", async () => {
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const starting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => {
      throw new BackendError("backend.unavailable");
    },
    start: () => {
      entered();
      return starting;
    },
  });
  const abort = new AbortController();
  const work = coordinator.connect({ signal: abort.signal });
  await ready;
  abort.abort(new Error("cancelled"));
  await expect(work).rejects.toThrow("cancelled");
  release();
  await starting;
});

test("caller deadline stops startup wait without stopping shared startup", async () => {
  let release!: () => void;
  const starting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => {
      throw new BackendError("backend.unavailable");
    },
    start: () => starting,
  });
  await expect(coordinator.connect({ deadline: Date.now() + 20 })).rejects.toMatchObject({
    code: "backend.deadline-exceeded",
  });
  release();
  await starting;
});

test("caller deadline also covers the post-start connection handshake", async () => {
  let connectAttempts = 0;
  let release!: () => void;
  const connecting = new Promise<BackendClient>((resolve) => {
    release = () => resolve(client());
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => {
      connectAttempts++;
      if (connectAttempts === 1) throw new BackendError("backend.unavailable");
      return connecting;
    },
    start: async () => undefined,
  });
  await expect(coordinator.connect({ deadline: Date.now() + 20 })).rejects.toMatchObject({
    code: "backend.deadline-exceeded",
  });
  release();
  await connecting;
});

test("index build starts on demand and only observes the daemon-owned operation", async () => {
  const events: string[] = [];
  let running = false;
  const firstOperation = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const connected = client({
    buildIndex: async () => {
      events.push("build");
      return { operationId: firstOperation, state: "building" };
    },
    indexOperation: async (operationId) => {
      events.push(`poll:${operationId}`);
      return {
        operationId,
        state: "ready",
        index: { state: "ready", profileId: "a".repeat(64), vectorCount: 1 },
      };
    },
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => {
      if (!running) throw new BackendError("backend.unavailable");
      return connected;
    },
    start: async () => {
      events.push("start");
      running = true;
    },
  });
  await expect(createIndexRuntimeClient(coordinator).build(root)).resolves.toMatchObject({
    operationId: firstOperation,
    state: "ready",
  });
  expect(events).toEqual(["start", "build", `poll:${firstOperation}`]);
});

test("index build preserves terminal failures other than not-loaded", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const connected = client({
    buildIndex: async () => ({ operationId, state: "failed", error: "embedding.busy" }),
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => connected,
    start: async () => {
      throw new Error("must not start");
    },
  });
  await expect(createIndexRuntimeClient(coordinator).build(root)).resolves.toEqual({
    operationId,
    state: "failed",
    error: "embedding.busy",
  });
});

test("index build keeps an accepted preparing operation when model observation reaches its deadline", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const preparationId = "1f8fad5b-d9cb-469f-a165-70867728950e";
  const connected = client({
    buildIndex: async () => ({ operationId, state: "preparing", preparationId }),
    modelPreparation: async () => {
      throw new BackendError("backend.deadline-exceeded");
    },
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => connected,
    start: async () => {
      throw new Error("must not start");
    },
  });

  await expect(createIndexRuntimeClient(coordinator).build(root)).resolves.toEqual({
    operationId,
    state: "preparing",
    preparationId,
  });
});

test("index build forwards a Store-only cache root to the Backend operation", async () => {
  let received: unknown;
  const connected = client({
    buildIndex: async (_root, options) => {
      received = options;
      return {
        operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        state: "ready",
        index: { state: "ready", profileId: "a".repeat(64), vectorCount: 1 },
      };
    },
  });
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => connected,
    start: async () => {
      throw new Error("must not start");
    },
  });
  await createIndexRuntimeClient(coordinator).build(root, { cacheRoot: "/tmp/query-cache" });
  expect(received).toMatchObject({ cacheRoot: "/tmp/query-cache" });
});
