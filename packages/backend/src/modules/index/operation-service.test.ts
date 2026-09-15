import { expect, test } from "bun:test";

import {
  SemanticIndexError,
  StoreBusyError,
  type SemanticIndexService,
  type StorageRoot,
} from "@lorelum/engine";

import { EmbeddingError } from "../embedding/errors";
import { EMBEDDING_MODEL, ENCODING_ID } from "../embedding/model";
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

function modelStatus(state: "loading" | "ready" | "failed") {
  return {
    state,
    encodingId: ENCODING_ID,
    device: "cpu" as const,
    dimensions: EMBEDDING_MODEL.dimensions,
    threads: 4,
    ...(state === "failed" ? { error: "embedding.download-failed" as const } : {}),
  };
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

test("joins a running build and preserves the terminal Engine status", async () => {
  const task = deferred<Awaited<ReturnType<SemanticIndexService["build"]>>>();
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => task.promise,
    rebuild: async () => task.promise,
  };
  const service = createIndexOperationService(engine);
  const first = service.build(root);
  expect(first.state).toBe("building");
  expect(service.rebuild(root)).toEqual(first);
  expect(service.build({ rootPath: "/tmp/lorelum-other-index-operation" })).toEqual(first);

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

test("continues the same operation after automatic model preparation", async () => {
  let builds = 0;
  const preparationDone = deferred<void>();
  let preparationBegun = 0;
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => {
      builds += 1;
      if (builds === 1) {
        throw new SemanticIndexError("Embedding is not loaded", {
          cause: new EmbeddingError("embedding.not-loaded"),
        });
      }
      return { built: true, status: { state: "ready", profileId, vectorCount: 3 } };
    },
    rebuild: async () => {
      throw new Error("unexpected rebuild");
    },
  };
  const service = createIndexOperationService(engine, {
    beginModelPreparation: () => {
      preparationBegun += 1;
      return {
        preparationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        status: modelStatus("loading"),
      };
    },
    waitModelPreparation: async (preparationId) => {
      expect(preparationId).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
      await preparationDone.promise;
      return modelStatus("ready");
    },
  });

  const started = service.build(root);
  const preparing = await waitFor(() => {
    const current = service.operation(started.operationId);
    return current?.state === "preparing" ? current : undefined;
  });
  expect(preparing).toEqual({
    operationId: started.operationId,
    state: "preparing",
    preparationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  });
  expect(preparationBegun).toBe(1);
  expect(builds).toBe(1);
  expect(service.rebuild(root)).toEqual(preparing);

  preparationDone.resolve();
  const ready = await waitFor(() => {
    const current = service.operation(started.operationId);
    return current?.state === "ready" ? current : undefined;
  });
  expect(builds).toBe(2);
  expect(ready).toEqual({
    operationId: started.operationId,
    state: "ready",
    index: { state: "ready", profileId, vectorCount: 3 },
  });
});

test("maps preparation failure to failed without retrying Engine", async () => {
  let builds = 0;
  const engine: SemanticIndexService = {
    status: async () => ({ state: "missing", profileId }),
    build: async () => {
      builds += 1;
      throw new EmbeddingError("embedding.not-loaded");
    },
    rebuild: async () => {
      throw new Error("unexpected rebuild");
    },
  };
  const service = createIndexOperationService(engine, {
    beginModelPreparation: () => ({
      preparationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      status: modelStatus("loading"),
    }),
    waitModelPreparation: async () => {
      throw new EmbeddingError("embedding.download-failed");
    },
  });

  const started = service.build(root);
  const failed = await waitFor(() => {
    const current = service.operation(started.operationId);
    return current?.state === "failed" ? current : undefined;
  });
  expect(builds).toBe(1);
  expect(failed).toEqual({
    operationId: started.operationId,
    state: "failed",
    error: "embedding.download-failed",
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
