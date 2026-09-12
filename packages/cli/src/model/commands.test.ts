import type { BackendClient } from "@lorelum/backend/client";
import {
  EMBEDDING_MODEL,
  ENCODING_ID,
  EmbeddingError,
  type ModelStatus,
} from "@lorelum/backend/protocol";
import { expect, test } from "bun:test";
import { run } from "../main";
import { validateJsonSchema } from "../output/protocol-schema.test-helper";
import { protocolResponseSchema } from "../output/protocol";
import { describeCommand, snapshotCommandDefinitions } from "../registry";
import { createModelCommands, type ModelCommandServices } from "./commands";

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

test("model commands use the injected client and publish model status", async () => {
  const calls: string[] = [];
  const result = await Promise.all(
    (["model.load", "model.status", "model.unload"] as const).map((command) =>
      invoke(command, { createClient: async () => fakeClient(calls) }),
    ),
  );
  expect(calls).toEqual(["load", "status", "unload"]);
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
