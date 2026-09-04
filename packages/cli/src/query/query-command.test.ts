import { expect, test } from "bun:test";

import {
  StoreRecoveryRequiredError,
  defaultStorageRoot,
  type QueryRequest,
  type QueryResult,
  type QueryService,
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
import { createQueryCommand } from "./query-command.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const fixtureResult: QueryResult = {
  query: "axios call in React component",
  k: 5,
  total: 1,
  generation: 1,
  effectiveRevision: 1,
  results: [
    {
      id: "react.api-client",
      title: "Layer React API access",
      stage: "api-layer",
      tech_stack: ["react", "typescript"],
      applies_when: "adding remote requests to a React interface",
    },
  ],
};

function service(result: QueryResult = fixtureResult): QueryService {
  return {
    async query() {
      return result;
    },
  };
}

test("describes the LocalStore-backed query command contract", () => {
  expect(describeCommand("query")).toMatchObject({
    name: "query",
    usage: "query <query>",
    positionals: [{ name: "query", required: true }],
    options: [
      { name: "-h, --help", required: false },
      { name: "--log-level <level>", required: false },
      { name: "--store-root <path>", required: false },
      { name: "--top-k <count>", required: false },
    ],
    errorCodes: ["usage.invalid", "runtime.unexpected", "store.busy", "store.recovery-required"],
    exitCodes: [0, 2],
  });
});

test("returns Practices through the JSON protocol", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createQueryCommand({ query: service(), storageRoot: defaultStorageRoot() }),
  ]);

  expect(
    await run(["query", fixtureResult.query, "--top-k", "5"], { registry: definitions, stdout }),
  ).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ command: "query", ok: true, data: fixtureResult });

  const description = describeCommand("query") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);
});

test("rejects blank queries and invalid top-k values before service dispatch", async () => {
  const calls: string[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createQueryCommand({
      query: {
        async query(request) {
          calls.push(request.query);
          return fixtureResult;
        },
      },
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  const invocations = [
    ["query", "   "],
    ["query", "axios", "--top-k", "0"],
    ["query", "axios", "--top-k", "51"],
  ] as const;
  await Promise.all(
    invocations.map(async (invocation) => {
      const stdout = new MemoryWriter();
      expect(await run([...invocation], { registry: definitions, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        command: "query",
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
    createQueryCommand({
      query: {
        async query() {
          throw new StoreRecoveryRequiredError("test recovery failure");
        },
      },
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  expect(await run(["query", "axios component"], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "query",
    ok: false,
    error: { code: "store.recovery-required" },
  });
});

test("resolves --store-root and forwards the selected Store to the service", async () => {
  const requests: QueryRequest[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createQueryCommand({
      query: {
        async query(request) {
          requests.push(request);
          return fixtureResult;
        },
      },
      storageRoot: { rootPath: "default-user-store" },
    }),
  ]);

  const stdout = new MemoryWriter();
  expect(
    await run(["query", "axios", "--store-root", "isolated-store"], {
      registry: definitions,
      stdout,
    }),
  ).toBe(0);
  expect(requests[0]?.storageRoot).toEqual({
    rootPath: resolve(process.cwd(), "isolated-store"),
  });
});

test("rejects an empty --store-root value before service dispatch", async () => {
  const calls: string[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createQueryCommand({
      query: {
        async query(request) {
          calls.push(request.query);
          return fixtureResult;
        },
      },
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  const stdout = new MemoryWriter();
  expect(await run(["query", "axios", "--store-root", ""], { registry: definitions, stdout })).toBe(
    2,
  );
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "query",
    ok: false,
    error: { code: "usage.invalid" },
  });
  expect(calls).toEqual([]);
});

test("query is included in the production command registry", () => {
  expect(commandRegistry.map((definition) => definition.name)).toContain("query");
});
