import type { BackendSupervisor } from "@lorelum/backend/control";
import { expect, test } from "bun:test";

import { BackendError, type BackendStatus } from "@lorelum/backend/protocol";

import { run } from "../main.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "../output/protocol-schema.test-helper.js";
import { protocolResponseSchema } from "../output/protocol.js";
import { describeCommand, snapshotCommandDefinitions } from "../registry.js";
import { createBackendCommands, type BackendCommandServices } from "./control-commands.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

function services(supervisor: BackendSupervisor): BackendCommandServices {
  return { createSupervisor: async () => supervisor };
}

async function invoke(command: string, supervisor: BackendSupervisor) {
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions(createBackendCommands(services(supervisor)));
  const exitCode = await run(command.split("."), { registry: definitions, stdout });
  const response = JSON.parse(stdout.value);
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  return {
    definition: definitions.find((definition) => definition.name === command),
    exitCode,
    response,
  };
}

const ready: BackendStatus = {
  state: "ready",
  model: "unloaded",
  instanceId: "instance-1",
  buildIdentity: "build-1",
};

test("calls the injected backend supervisor for each control command", async () => {
  const calls: string[] = [];
  const supervisor: BackendSupervisor = {
    async start() {
      calls.push("start");
      return ready;
    },
    async status() {
      calls.push("status");
      return ready;
    },
    async stop() {
      calls.push("stop");
      return { state: "stopped", model: "unloaded" };
    },
  };

  const results = await Promise.all(
    (["backend.start", "backend.status", "backend.stop"] as const).map(async (command) => ({
      command,
      result: await invoke(command, supervisor),
    })),
  );
  for (const { command, result } of results) {
    expect(result.exitCode).toBe(0);
    expect(result.response).toMatchObject({ command, ok: true });
    expect(result.definition).toBeDefined();
    expect(validateJsonSchema(result.response.data, result.definition!.resultSchema)).toEqual([]);
  }
  expect(calls).toEqual(["start", "status", "stop"]);
});

test("publishes the three backend commands from the same registry used by the parser", () => {
  const definitions = createBackendCommands(
    services({ start: async () => ready, status: async () => ready, stop: async () => ready }),
  );
  expect(definitions.map((definition) => definition.name)).toEqual([
    "backend.start",
    "backend.status",
    "backend.stop",
  ]);
  expect(describeCommand("backend.start", definitions)).toMatchObject({
    name: "backend.start",
    usage: "backend start",
    errorCodes: expect.arrayContaining(["backend.unavailable", "backend.incompatible"]),
    exitCodes: [0, 2],
  });
});

test("preserves declared backend failures without exposing unexpected details", async () => {
  const expected = await invoke("backend.status", {
    start: async () => ready,
    status: async () => {
      throw new BackendError("backend.unavailable");
    },
    stop: async () => ready,
  });
  expect(expected.exitCode).toBe(2);
  expect(expected.response.error).toEqual({
    code: "backend.unavailable",
    message: "The local backend is not running.",
  });

  const unexpected = await invoke("backend.status", {
    start: async () => ready,
    status: async () => {
      throw new Error("private backend detail");
    },
    stop: async () => ready,
  });
  expect(unexpected.exitCode).toBe(2);
  expect(unexpected.response.error.code).toBe("runtime.unexpected");
  expect(JSON.stringify(unexpected.response)).not.toContain("private backend detail");
});

test("discovery's supported schema accepts starting and rejects unknown states", () => {
  const [definition] = createBackendCommands(
    services({ start: async () => ready, status: async () => ready, stop: async () => ready }),
  );
  expect(validateJsonSchema({ ...ready, state: "starting" }, definition!.resultSchema)).toEqual([]);
  expect(
    validateJsonSchema({ ...ready, state: "arbitrary" }, definition!.resultSchema).length,
  ).toBeGreaterThan(0);
});
