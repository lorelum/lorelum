import { expect, test } from "bun:test";

import {
  StoreRecoveryRequiredError,
  UnknownPracticeError,
  defaultStorageRoot,
  type GetRequest,
  type GetResult,
  type GetService,
} from "@lorelum/engine";
import { resolve } from "node:path";

import { run } from "../main.js";
import {
  commandRegistry,
  describeCommand,
  snapshotCommandDefinitions,
  type CommandDefinition,
} from "../registry.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import type { JsonSchema } from "../output/protocol.js";
import { createGetCommand } from "./get-command.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const fixtureResult: GetResult = {
  generation: 1,
  effectiveRevision: 1,
  practice: {
    id: "react.api-client",
    title: "Layer React API access",
    stage: "api-layer",
    tech_stack: ["react", "typescript"],
    applies_when: "adding remote requests to a React interface",
    severity: "critical",
    body: "Keep transport behind a feature API boundary.",
    anti_patterns: [
      {
        id: "react.direct-http-in-component",
        name: "Direct HTTP client in component",
        description: "Calling axios or fetch directly from a component couples UI to transport.",
        severity: "critical",
      },
    ],
  },
  sources: [{ pack: "local-get-fixture", sourcePath: "practices/react/api-client.md" }],
};

function service(result: GetResult = fixtureResult): GetService {
  return {
    async get() {
      return result;
    },
  };
}

test("describes the LocalStore-backed get command contract", () => {
  expect(describeCommand("get")).toMatchObject({
    name: "get",
    usage: "get <practice-id>",
    positionals: [{ name: "practice-id", required: true }],
    options: [
      { name: "-h, --help", required: false },
      { name: "--log-level <level>", required: false },
      { name: "--store-root <path>", required: false },
    ],
    errorCodes: [
      "usage.invalid",
      "runtime.unexpected",
      "store.busy",
      "store.recovery-required",
      "get.unknown_practice",
    ],
    exitCodes: [0, 2],
  });
});

test("returns the canonical Practice through the JSON protocol", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createGetCommand({ get: service(), storageRoot: defaultStorageRoot() }),
  ]);

  expect(await run(["get", fixtureResult.practice.id], { registry: definitions, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ command: "get", ok: true, data: fixtureResult });

  const description = describeCommand("get") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);
});

test("maps an unknown id to the declared get.unknown_practice error", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createGetCommand({
      get: {
        async get() {
          throw new UnknownPracticeError("react.missing");
        },
      },
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  expect(await run(["get", "react.missing"], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "get",
    ok: false,
    error: { code: "get.unknown_practice" },
  });
});

test("rejects blank ids and empty --store-root values before service dispatch", async () => {
  const calls: string[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createGetCommand({
      get: {
        async get(request) {
          calls.push(request.practiceId);
          return fixtureResult;
        },
      },
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  const invocations = [
    ["get", "   "],
    ["get", "react.api", "--store-root", ""],
  ] as const;
  await Promise.all(
    invocations.map(async (invocation) => {
      const stdout = new MemoryWriter();
      expect(await run([...invocation], { registry: definitions, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        command: "get",
        ok: false,
        error: { code: "usage.invalid" },
      });
    }),
  );
  expect(calls).toEqual([]);
});

test("maps LocalStore recovery failures to the declared public error", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createGetCommand({
      get: {
        async get() {
          throw new StoreRecoveryRequiredError("test recovery failure");
        },
      },
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  expect(await run(["get", "react.api-client"], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "get",
    ok: false,
    error: { code: "store.recovery-required" },
  });
});

test("resolves --store-root and forwards the selected Store to the service", async () => {
  const requests: GetRequest[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createGetCommand({
      get: {
        async get(request) {
          requests.push(request);
          return fixtureResult;
        },
      },
      storageRoot: { rootPath: "default-user-store" },
    }),
  ]);

  const stdout = new MemoryWriter();
  expect(
    await run(["get", "react.api-client", "--store-root", "isolated-store"], {
      registry: definitions,
      stdout,
    }),
  ).toBe(0);
  expect(requests[0]?.practiceId).toBe("react.api-client");
  expect(requests[0]?.storageRoot).toEqual({
    rootPath: resolve(process.cwd(), "isolated-store"),
  });
});

test("get is included in the production command registry", () => {
  expect(commandRegistry.map((definition) => definition.name)).toContain("get");
});
