import type { BackendSupervisor } from "@lorelum/backend/control";
import { expect, test } from "bun:test";

import { BackendError, type BackendStatus } from "@lorelum/backend/protocol";

import { run as runCli } from "../main";
import { validateJsonSchema, validateProtocolSchema } from "../output/protocol-schema.test-helper";
import { protocolResponseSchema } from "../output/protocol";
import { describeCommand, snapshotCommandDefinitions } from "../registry";
import { createBackendCommands, type BackendCommandServices } from "./control-commands";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

function services(supervisor: BackendSupervisor): BackendCommandServices {
  return { createSupervisor: async () => supervisor };
}

function backendSupervisor(overrides: Partial<BackendSupervisor> = {}): BackendSupervisor {
  return {
    start: async () => ready,
    status: async () => ready,
    stop: async () => ({ state: "stopped", model: "unloaded" }),
    stopIfIdle: async () => ({ state: "stopped" }),
    inspectCompatibilityRecovery: async () => ({
      action: "backend.stop-if-idle",
      automation: "defer",
      reason: "unknown-activity",
      retry: "original-command",
    }),
    acquireTaskLease: async () => ({
      leaseId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      expiresAt: "2026-09-16T00:00:00.000Z",
    }),
    renewTaskLease: async (leaseId) => ({
      leaseId,
      expiresAt: "2026-09-16T00:01:00.000Z",
    }),
    releaseTaskLease: async () => {},
    ...overrides,
  };
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
  const supervisor = backendSupervisor({
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
  });

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

test("backend stop --if-idle returns a deferred handoff without calling explicit stop", async () => {
  const calls: string[] = [];
  const result = await invoke(
    "backend.stop",
    backendSupervisor({
      async stop() {
        calls.push("stop");
        return { state: "stopped", model: "unloaded" };
      },
      async stopIfIdle() {
        calls.push("stopIfIdle");
        return { state: "deferred", reason: "active-long-task" };
      },
    }),
  );
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions(
    createBackendCommands(
      services(
        backendSupervisor({
          async stopIfIdle() {
            calls.push("flaggedStopIfIdle");
            return { state: "deferred", reason: "active-long-task" };
          },
        }),
      ),
    ),
  );
  expect(await run(["backend", "stop", "--if-idle"], { registry: definitions, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "backend.stop",
    ok: true,
    data: { state: "deferred", reason: "active-long-task" },
  });
  expect(result.response.data).toEqual({ state: "stopped", model: "unloaded" });
  expect(calls).toEqual(["stop", "flaggedStopIfIdle"]);
});

test("machine lease commands pass bounded TTLs and opaque lease IDs to the supervisor", async () => {
  const calls: unknown[] = [];
  const supervisor = backendSupervisor({
    async acquireTaskLease(ttlMs) {
      calls.push(["acquire", ttlMs]);
      return {
        leaseId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        expiresAt: "2026-09-16T00:00:00.000Z",
      };
    },
    async renewTaskLease(leaseId, ttlMs) {
      calls.push(["renew", leaseId, ttlMs]);
      return { leaseId, expiresAt: "2026-09-16T00:01:00.000Z" };
    },
    async releaseTaskLease(leaseId) {
      calls.push(["release", leaseId]);
    },
  });
  const definitions = snapshotCommandDefinitions(createBackendCommands(services(supervisor)));
  for (const args of [
    ["backend", "lease", "acquire", "--ttl-ms", "1200"],
    ["backend", "lease", "renew", "0f8fad5b-d9cb-469f-a165-70867728950e"],
    ["backend", "lease", "release", "0f8fad5b-d9cb-469f-a165-70867728950e"],
  ]) {
    const stdout = new MemoryWriter();
    // eslint-disable-next-line no-await-in-loop -- each command has independent JSON output.
    expect(await run(args, { registry: definitions, stdout })).toBe(0);
  }
  expect(calls).toEqual([
    ["acquire", 1200],
    ["renew", "0f8fad5b-d9cb-469f-a165-70867728950e", 60_000],
    ["release", "0f8fad5b-d9cb-469f-a165-70867728950e"],
  ]);
});

test("publishes backend lifecycle and machine lease commands from the parser registry", () => {
  const definitions = createBackendCommands(services(backendSupervisor()));
  expect(definitions.map((definition) => definition.name)).toEqual([
    "backend.start",
    "backend.status",
    "backend.stop",
    "backend.lease.acquire",
    "backend.lease.renew",
    "backend.lease.release",
  ]);
  expect(describeCommand("backend.start", definitions)).toMatchObject({
    name: "backend.start",
    usage: "backend start",
    errorCodes: expect.arrayContaining(["backend.unavailable", "backend.incompatible"]),
    exitCodes: [0, 2],
  });
});

test("preserves declared backend failures without exposing unexpected details", async () => {
  const expected = await invoke(
    "backend.status",
    backendSupervisor({
      status: async () => {
        throw new BackendError("backend.unavailable");
      },
    }),
  );
  expect(expected.exitCode).toBe(2);
  expect(expected.response.error).toEqual({
    code: "backend.unavailable",
    message: "The local backend is not running.",
  });

  const unexpected = await invoke(
    "backend.status",
    backendSupervisor({
      status: async () => {
        throw new Error("private backend detail");
      },
    }),
  );
  expect(unexpected.exitCode).toBe(2);
  expect(unexpected.response.error.code).toBe("runtime.unexpected");
  expect(JSON.stringify(unexpected.response)).not.toContain("private backend detail");
});

test("discovery's supported schema accepts starting and rejects unknown states", () => {
  const [definition] = createBackendCommands(services(backendSupervisor()));
  expect(validateJsonSchema({ ...ready, state: "starting" }, definition!.resultSchema)).toEqual([]);
  expect(
    validateJsonSchema({ ...ready, state: "arbitrary" }, definition!.resultSchema).length,
  ).toBeGreaterThan(0);
});

test("only backend start asks the config layer to initialize files", async () => {
  const initialization: (boolean | undefined)[] = [];
  const definitions = createBackendCommands({
    createSupervisor: async (options) => {
      initialization.push(options?.initialize);
      return backendSupervisor();
    },
  });
  for (const command of ["start", "status", "stop"]) {
    expect(
      // eslint-disable-next-line no-await-in-loop
      await run(["backend", command], {
        registry: snapshotCommandDefinitions(definitions),
        stdout: new MemoryWriter(),
      }),
    ).toBe(0);
  }
  expect(initialization).toEqual([true, false, false]);
});
