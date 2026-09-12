import type { BackendClient } from "@lorelum/backend/client";
import {
  BackendRemoteError,
  EMBEDDING_MODEL,
  ENCODING_ID,
  type IndexOperation,
  type IndexStatus,
} from "@lorelum/backend/protocol";
import { expect, test } from "bun:test";

import { run } from "../main";
import { protocolResponseSchema, type OutputWriter } from "../output/protocol";
import { validateJsonSchema } from "../output/protocol-schema.test-helper";
import { snapshotCommandDefinitions } from "../registry";
import { createIndexCommands } from "./index-commands";

class MemoryWriter implements OutputWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

const profileId = "a".repeat(64);

function client(
  callbacks: {
    readonly status?: (rootPath: string) => Promise<IndexStatus>;
    readonly build?: (rootPath: string) => Promise<IndexOperation>;
    readonly operation?: (operationId: string) => Promise<IndexOperation>;
  } = {},
): BackendClient {
  return {
    identity: async () => ({
      instanceId: "instance",
      buildIdentity: "build",
      protocolVersion: 1,
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
    unloadModel: async () => ({
      state: "unloaded",
      encodingId: ENCODING_ID,
      device: "cpu",
      dimensions: EMBEDDING_MODEL.dimensions,
      threads: 4,
    }),
    embed: async () => ({ encodingId: ENCODING_ID, vectors: [] }),
    query: async () => ({ mode: "keyword", results: [] }),
    indexStatus: async (root) =>
      callbacks.status?.(root.rootPath) ?? { state: "missing", profileId },
    buildIndex: async (root) =>
      callbacks.build?.(root.rootPath) ?? {
        operationId: crypto.randomUUID(),
        state: "ready",
        index: { state: "ready", profileId },
      },
    rebuildIndex: async () => ({
      operationId: crypto.randomUUID(),
      state: "ready",
      index: { state: "ready", profileId },
    }),
    indexOperation:
      callbacks.operation ??
      (async (operationId) => ({
        operationId,
        state: "ready",
        index: { state: "ready", profileId },
      })),
  };
}

async function invoke(arguments_: string[], backend: BackendClient) {
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions(
    createIndexCommands({
      createClient: async () => backend,
      storageRoot: { rootPath: "/default" },
    }),
  );
  const exitCode = await run(arguments_, { registry: definitions, stdout });
  const response = JSON.parse(stdout.value);
  expect(validateJsonSchema(response, protocolResponseSchema)).toEqual([]);
  return { exitCode, response };
}

test("index status forwards the selected Store root to the Backend client", async () => {
  const result = await invoke(
    ["--store-root", "/isolated", "index", "status"],
    client({
      status: async (rootPath) => {
        expect(rootPath).toBe("/isolated");
        return { state: "stale", profileId, vectorCount: 4 };
      },
    }),
  );
  expect(result.exitCode).toBe(0);
  expect(result.response).toMatchObject({
    command: "index.status",
    data: { state: "stale", profileId, vectorCount: 4 },
  });
});

test("index build polls a Backend operation until its ready index result", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  let polls = 0;
  const result = await invoke(
    ["index", "build"],
    client({
      build: async () => ({ operationId, state: "building" }),
      operation: async (id) => {
        polls++;
        expect(id).toBe(operationId);
        return {
          operationId,
          state: "ready",
          index: { state: "ready", profileId, vectorCount: 1 },
        };
      },
    }),
  );
  expect(polls).toBe(1);
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual({
    operationId,
    state: "ready",
    index: { state: "ready", profileId, vectorCount: 1 },
  });
});

test("index build polls a terminal embedding failure from the accepted operation", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  let polls = 0;
  const result = await invoke(
    ["index", "build"],
    client({
      build: async () => ({
        operationId,
        state: "building",
      }),
      operation: async (id) => {
        polls++;
        expect(id).toBe(operationId);
        return { operationId, state: "failed", error: "embedding.not-loaded" };
      },
    }),
  );
  expect(polls).toBe(1);
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "embedding.not-loaded",
    message: "Load the embedding model before encoding text.",
  });
});

test("index build preserves Store availability failures from its accepted operation", async () => {
  const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const result = await invoke(
    ["index", "build"],
    client({
      build: async () => ({ operationId, state: "building" }),
      operation: async () => ({ operationId, state: "failed", error: "store.busy" }),
    }),
  );
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "store.busy",
    message: "The local Pack store is busy.",
  });
});

test("index status preserves Store availability failures from the Backend boundary", async () => {
  const result = await invoke(
    ["index", "status"],
    client({
      status: async () => {
        throw new BackendRemoteError("store.busy");
      },
    }),
  );
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "store.busy",
    message: "The local Pack store is busy.",
  });
});
