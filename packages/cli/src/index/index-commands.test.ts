import type { BackendClient } from "@lorelum/backend/client";
import type { IndexRuntimeClient } from "@lorelum/backend/coordination";
import {
  BackendError,
  BackendRemoteError,
  EMBEDDING_MODEL,
  ENCODING_ID,
  type IndexOperation,
  type IndexStatus,
} from "@lorelum/backend/protocol";
import { expect, test } from "bun:test";

import { resolve } from "node:path";

import { run as runCli } from "../main";
import { protocolResponseSchema, type OutputWriter } from "../output/protocol";
import { validateJsonSchema } from "../output/protocol-schema.test-helper";
import { snapshotCommandDefinitions } from "../registry";
import { createIndexCommands } from "./index-commands";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter implements OutputWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

const profileId = "a".repeat(64);

function backend(
  status: (rootPath: string) => Promise<IndexStatus> = async () => ({
    state: "missing",
    profileId,
  }),
): BackendClient {
  return {
    identity: async () => ({
      instanceId: "instance",
      buildIdentity: "build",
      protocolVersion: 2,
      proof: "a".repeat(64),
    }),
    status: async () => ({ state: "ready", model: "unloaded" }),
    stop: async () => ({ state: "stopped", model: "unloaded" }),
    loadModel: async () => ({
      state: "ready",
      encodingId: ENCODING_ID,
      device: "cpu",
      dimensions: EMBEDDING_MODEL.dimensions,
      threads: 4,
    }),
    statusModel: async () => ({
      state: "ready",
      encodingId: ENCODING_ID,
      device: "cpu",
      dimensions: EMBEDDING_MODEL.dimensions,
      threads: 4,
    }),
    beginModelPreparation: async () => {
      throw new Error("index command must not prepare model");
    },
    modelPreparation: async () => {
      throw new Error("index command must not prepare model");
    },
    unloadModel: async () => ({
      state: "unloaded",
      encodingId: ENCODING_ID,
      device: "cpu",
      dimensions: EMBEDDING_MODEL.dimensions,
      threads: 4,
    }),
    embed: async () => ({ encodingId: ENCODING_ID, vectors: [] }),
    query: async () => ({ mode: "keyword", results: [] }),
    indexStatus: async (root) => status(root.rootPath),
    buildIndex: async () => {
      throw new Error("build command must use the runtime client");
    },
    rebuildIndex: async () => {
      throw new Error("rebuild command must use the runtime client");
    },
    indexOperation: async () => {
      throw new Error("build command must use the runtime client");
    },
  };
}

function runtime(
  build: (rootPath: string) => Promise<IndexOperation>,
  rebuild: (rootPath: string) => Promise<IndexOperation> = build,
): IndexRuntimeClient {
  return {
    build: (root) => build(root.rootPath),
    rebuild: (root) => rebuild(root.rootPath),
  };
}

async function invoke(
  arguments_: string[],
  services: {
    readonly backend?: BackendClient;
    readonly runtime?: IndexRuntimeClient;
  } = {},
) {
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions(
    createIndexCommands({
      createClient: async () => services.backend ?? backend(),
      createRuntimeClient: async () =>
        services.runtime ??
        runtime(async () => {
          throw new Error("unexpected runtime client");
        }),
      storageRoot: { rootPath: "/default" },
    }),
  );
  const exitCode = await run(arguments_, { registry: definitions, stdout });
  const response = JSON.parse(stdout.value);
  expect(validateJsonSchema(response, protocolResponseSchema)).toEqual([]);
  return { exitCode, response };
}

test("index status forwards the selected Store root without creating a runtime client", async () => {
  const result = await invoke(["--store-root", "/isolated", "index", "status"], {
    backend: backend(async (rootPath) => {
      // The CLI forwards the normalized root; Windows resolves "/isolated" against the drive.
      expect(rootPath).toBe(resolve("/isolated"));
      return { state: "stale", profileId, vectorCount: 4 };
    }),
    runtime: runtime(async () => {
      throw new Error("status must not start runtime");
    }),
  });
  expect(result.exitCode).toBe(0);
  expect(result.response).toMatchObject({
    command: "index.status",
    data: { state: "stale", profileId, vectorCount: 4 },
  });
});

test("index commands defer automatic ProjectContext resolution to Backend and forward the selected cache", async () => {
  const calls: unknown[] = [];
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const result = await invoke(
    ["--store-root", "/isolated", "--cache-root", "/cache", "index", "build"],
    {
      runtime: {
        async build(root, options) {
          calls.push(["build", root, options]);
          return {
            operationId,
            state: "queued",
            indexedPracticeCount: 0,
            totalPracticeCount: 2,
          };
        },
        async rebuild() {
          throw new Error("unexpected rebuild");
        },
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual({
    operationId,
    state: "queued",
    indexedPracticeCount: 0,
    totalPracticeCount: 2,
  });
  expect(calls).toEqual([
    [
      "build",
      { rootPath: resolve("/isolated") },
      {
        projectContext: {
          cacheRoot: resolve("/cache"),
          startDirectory: process.cwd(),
        },
      },
    ],
  ]);
});

test("index build forwards the selected Store root to the runtime client", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const result = await invoke(["--store-root", "/isolated", "index", "build"], {
    runtime: runtime(async (rootPath) => {
      expect(rootPath).toBe(resolve("/isolated"));
      return {
        operationId,
        state: "ready",
        index: { state: "ready", profileId, vectorCount: 1 },
      };
    }),
  });
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual({
    operationId,
    state: "ready",
    index: { state: "ready", profileId, vectorCount: 1 },
  });
});

test.each([
  [{ operationId: "0f8fad5b-d9cb-469f-a165-70867728950e", state: "building" as const }],
  [
    {
      operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      state: "preparing" as const,
      preparationId: "1f8fad5b-d9cb-469f-a165-70867728950e",
    },
  ],
])("index build returns an accepted non-terminal operation: %j", async (operation) => {
  const result = await invoke(["index", "build"], {
    runtime: runtime(async () => operation),
  });
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual(operation);
});

test("index operation reads an operation without creating the runtime client", async () => {
  const operation = {
    operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    state: "building" as const,
  };
  const result = await invoke(["index", "operation", operation.operationId], {
    backend: {
      ...backend(),
      indexOperation: async (operationId) => {
        expect(operationId).toBe(operation.operationId);
        return operation;
      },
    },
    runtime: runtime(async () => {
      throw new Error("operation must not create runtime client");
    }),
  });
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual(operation);
});

test("index operation reports an expired daemon-owned operation", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const result = await invoke(["index", "operation", operationId], {
    backend: {
      ...backend(),
      indexOperation: async () => {
        throw new BackendError("backend.operation-expired");
      },
    },
  });

  expect(result.exitCode).toBe(2);
  expect(result.response).toMatchObject({
    command: "index.operation",
    ok: false,
    error: { code: "backend.operation-expired" },
  });
});

test("index build preserves terminal embedding failures from the runtime client", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const result = await invoke(["index", "build"], {
    runtime: runtime(async () => ({
      operationId,
      state: "failed",
      error: "embedding.not-loaded",
    })),
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "embedding.not-loaded",
    message: "Load the embedding model before encoding text.",
  });
});

test("index build preserves Store availability failures from the runtime client", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const result = await invoke(["index", "build"], {
    runtime: runtime(async () => ({ operationId, state: "failed", error: "store.busy" })),
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "store.busy",
    message: "The local Pack store is busy.",
  });
});

test("index status preserves Store availability failures from the Backend boundary", async () => {
  const result = await invoke(["index", "status"], {
    backend: backend(async () => {
      throw new BackendRemoteError("store.busy");
    }),
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "store.busy",
    message: "The local Pack store is busy.",
  });
});
