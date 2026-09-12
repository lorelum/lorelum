import { expect, test } from "bun:test";

import { StoreBusyError, type SemanticIndexService, type StorageRoot } from "@lorelum/engine";

import { BackendError } from "../../protocol/errors";
import { EmbeddingError } from "../embedding/errors";
import { createIndexOperationService } from "./operation-service";

const root: StorageRoot = { rootPath: "/tmp/lorelum-index-operation" };
const profileId = "a".repeat(64);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    // eslint-disable-next-line no-await-in-loop -- bounded operation polling is sequential.
    await Bun.sleep(1);
  }
  throw new Error("operation did not settle");
}

test("serializes all builds and preserves the terminal Engine status", async () => {
  const task = deferred<Awaited<ReturnType<SemanticIndexService["build"]>>>();
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => task.promise,
    rebuild: async () => task.promise,
  };
  const service = createIndexOperationService(engine);
  const first = service.build(root);
  expect(first.state).toBe("building");
  expect(() => service.rebuild(root)).toThrow(new BackendError("backend.busy"));
  expect(() => service.build({ rootPath: "/tmp/lorelum-other-index-operation" })).toThrow(
    new BackendError("backend.busy"),
  );

  task.resolve({ built: true, status: { state: "ready", profileId, vectorCount: 2 } });
  const final = await waitFor(() => {
    const current = service.operation(first.operationId);
    return current?.state === "ready" ? current : undefined;
  });
  expect(final).toEqual({
    operationId: first.operationId,
    state: "ready",
    index: { state: "ready", profileId, vectorCount: 2 },
  });
});

test("records a failed operation without leaking the Engine failure", async () => {
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => {
      throw new Error("/private/index-path");
    },
    rebuild: async () => {
      throw new Error("/private/index-path");
    },
  };
  const service = createIndexOperationService(engine);
  const started = service.build(root);
  const final = await waitFor(() => {
    const current = service.operation(started.operationId);
    return current?.state === "failed" ? current : undefined;
  });
  expect(final).toEqual({
    operationId: started.operationId,
    state: "failed",
    error: "backend.failed",
  });
});

test("retains an expected embedding failure for the CLI boundary", async () => {
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
    rebuild: async () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
  };
  const service = createIndexOperationService(engine);
  const started = service.build(root);
  const final = await waitFor(() => {
    const current = service.operation(started.operationId);
    return current?.state === "failed" ? current : undefined;
  });
  expect(final).toEqual({
    operationId: started.operationId,
    state: "failed",
    error: "embedding.not-loaded",
  });
});

test("preserves Store availability errors and exposes an active-operation drain", async () => {
  const task = deferred<Awaited<ReturnType<SemanticIndexService["build"]>>>();
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => task.promise,
    rebuild: async () => task.promise,
  };
  const service = createIndexOperationService(engine);
  const started = service.build(root);
  let settled = false;
  const wait = service.waitForIdle().then(() => {
    settled = true;
  });
  await Bun.sleep(1);
  expect(settled).toBe(false);

  task.reject(new StoreBusyError("Store mutation is in progress"));
  await wait;
  expect(service.operation(started.operationId)).toEqual({
    operationId: started.operationId,
    state: "failed",
    error: "store.busy",
  });
});
