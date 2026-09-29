import type { BackendClient } from "@lorelum/backend/client";
import {
  EMBEDDING_MODEL,
  ENCODING_ID,
  EmbeddingError,
  type ModelStatus,
} from "@lorelum/backend/protocol";
import { expect, test } from "bun:test";
import { run as runCli } from "../main";
import { validateJsonSchema } from "../output/protocol-schema.test-helper";
import { protocolResponseSchema } from "../output/protocol";
import { describeCommand, snapshotCommandDefinitions } from "../registry";
import { createModelCommands, type ModelCommandServices } from "./commands";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

const ready: ModelStatus = {
  state: "ready",
  encodingId: ENCODING_ID,
  device: "cpu",
  dimensions: EMBEDDING_MODEL.dimensions,
  threads: 4,
};

function fakeClient(calls: string[]): BackendClient {
  return {
    identity: async () => ({
      instanceId: "instance",
      buildIdentity: "build",
      protocolVersion: 1,
      proof: "a".repeat(64),
    }),
    status: async () => ({ state: "ready", model: "unloaded" }),
    stop: async () => ({ state: "stopped", model: "unloaded" }),
    loadModel: async () => {
      calls.push("load");
      return ready;
    },
    statusModel: async () => {
      calls.push("status");
      return ready;
    },
    beginModelPreparation: async () => {
      throw new Error("metadata command must not prepare model");
    },
    modelPreparation: async () => {
      throw new Error("metadata command must not prepare model");
    },
    unloadModel: async () => {
      calls.push("unload");
      return { ...ready, state: "unloaded" };
    },
    embed: async () => ({ encodingId: ENCODING_ID, vectors: [] }),
    query: async () => ({ mode: "keyword", results: [] }),
    indexStatus: async () => ({ state: "missing", profileId: "a".repeat(64) }),
    buildIndex: async () => ({
      operationId: crypto.randomUUID(),
      state: "ready",
      index: { state: "ready", profileId: "a".repeat(64) },
    }),
    rebuildIndex: async () => ({
      operationId: crypto.randomUUID(),
      state: "ready",
      index: { state: "ready", profileId: "a".repeat(64) },
    }),
    indexOperation: async () => ({
      operationId: crypto.randomUUID(),
      state: "ready",
      index: { state: "ready", profileId: "a".repeat(64) },
    }),
    routeToolEvent: async () => {
      throw new Error("model command must not report Practice hints");
    },
    recordSuccessfulGet: async () => {
      throw new Error("model command must not report Practice hints");
    },
    readRecentHints: async () => {
      throw new Error("model command must not read Practice hints");
    },
  };
}

async function invoke(command: string, services: ModelCommandServices) {
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions(createModelCommands(services));
  const exitCode = await run(command.split("."), { registry: definitions, stdout });
  const response = JSON.parse(stdout.value);
  expect(validateJsonSchema(response, protocolResponseSchema)).toEqual([]);
  return { definitions, exitCode, response };
}

async function invokeText(command: string, services: ModelCommandServices) {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const definitions = snapshotCommandDefinitions(createModelCommands(services));
  const exitCode = await runCli(command.split("."), { registry: definitions, stdout, stderr });
  return { exitCode, stdout: stdout.value, stderr: stderr.value };
}

test("model commands use the injected client and publish model status", async () => {
  const calls: string[] = [];
  const result = await Promise.all(
    (["model.load", "model.status", "model.unload"] as const).map((command) =>
      invoke(command, { createClient: async () => fakeClient(calls) }),
    ),
  );
  expect(calls).toHaveLength(3);
  expect(calls).toEqual(expect.arrayContaining(["load", "status", "unload"]));
  for (const item of result) {
    expect(item.exitCode).toBe(0);
    expect(item.response.ok).toBe(true);
    expect(item.response.data.encodingId).toBe(ENCODING_ID);
  }
  expect(describeCommand("model.status", result[0]!.definitions)).toMatchObject({
    name: "model.status",
    usage: "model status",
  });
});

test("model commands preserve embedding errors", async () => {
  const result = await invoke("model.status", {
    createClient: async () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "embedding.not-loaded",
    message: "Load the embedding model before encoding text.",
  });
});

test("model status and load preserve structured resource failures", async () => {
  const resource = {
    kind: "native",
    file: "native/darwin-arm64/llama-server",
    check: "missing",
  } as const;
  const failed: ModelStatus = {
    ...ready,
    state: "failed",
    error: "embedding.native-resource-invalid",
    resource,
  };
  const status = await invoke("model.status", {
    createClient: async () => ({
      ...fakeClient([]),
      statusModel: async () => failed,
    }),
  });
  const message = new EmbeddingError(failed.error!, undefined, resource).message;
  expect(status.exitCode).toBe(0);
  expect(status.response.data).toMatchObject({
    state: "failed",
    error: "embedding.native-resource-invalid",
    message,
    resource,
  });

  const load = await invoke("model.load", {
    createClient: async () => ({
      ...fakeClient([]),
      loadModel: async () => {
        throw new EmbeddingError("embedding.native-resource-invalid", undefined, resource);
      },
    }),
  });
  expect(load.exitCode).toBe(2);
  expect(load.response.error).toMatchObject({
    code: "embedding.native-resource-invalid",
    message,
    resource,
  });

  const statusText = await invokeText("model.status", {
    createClient: async () => ({ ...fakeClient([]), statusModel: async () => failed }),
  });
  expect(statusText.exitCode).toBe(0);
  expect(statusText.stdout).toContain(`message: ${message}`);
  expect(statusText.stdout).toContain("resource:");
  expect(statusText.stdout).toContain("check: missing");

  const loadText = await invokeText("model.load", {
    createClient: async () => ({
      ...fakeClient([]),
      loadModel: async () => {
        throw new EmbeddingError("embedding.native-resource-invalid", undefined, resource);
      },
    }),
  });
  expect(loadText.exitCode).toBe(2);
  expect(loadText.stderr).toContain(`message: ${message}`);
  expect(loadText.stderr).toContain("resource:");
  expect(loadText.stderr).toContain("file: native/darwin-arm64/llama-server");
});
