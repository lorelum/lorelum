import { expect, test } from "bun:test";

import {
  createQueryService,
  InvalidQueryRequestError,
  KeywordIndexError,
  KeywordIndexUnavailableError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type QueryResult,
} from "@lorelum/engine";

import { run } from "../main.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "../output/protocol-schema.test-helper.js";
import { protocolResponseSchema } from "../output/protocol.js";
import { describeCommand, snapshotCommandDefinitions } from "../registry.js";
import { CliError } from "../runtime/errors.js";
import { createQueryCommand, type QueryCommandServices } from "./query-command.js";

const queryResult: QueryResult = {
  mode: "keyword",
  results: [
    {
      practiceId: "sample.react-auth",
      title: "Use the existing authentication service",
      stage: "implementation",
      techStack: ["react", "typescript"],
      appliesWhen: "adding authentication to a React page",
      severity: "warn",
      contentDigest: "a".repeat(64),
    },
  ],
};

async function invoke(args: readonly string[], queryService: QueryCommandServices["queryService"]) {
  const stdout = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const stderr = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const definition = createQueryCommand({
    queryService,
    storageRoot: { rootPath: "unused-default" },
  });
  const exitCode = await run([...args], {
    registry: snapshotCommandDefinitions([definition]),
    stdout,
    stderr,
  });
  expect(stdout.value.endsWith("\n")).toBe(true);
  expect(stdout.value.trim().split("\n")).toHaveLength(1);
  expect(stderr.value).toBe("");
  const response = JSON.parse(stdout.value);
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  return { exitCode, response, definition };
}

test("passes the exact text, parsed top-k, and selected Store root to QueryService", async () => {
  let request: unknown;
  let rootPath = "";
  const result = await invoke(["query", "React auth", "--top-k", "3"], {
    async query(root, received) {
      rootPath = root.rootPath;
      request = received;
      return queryResult;
    },
  });
  expect(rootPath).toBe("unused-default");
  expect(request).toEqual({ text: "React auth", limit: 3 });
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual(queryResult);
  expect(validateJsonSchema(result.response.data, result.definition.resultSchema)).toEqual([]);
});

test("resolves an explicit Store root and omits the optional limit by default", async () => {
  let request: unknown;
  let rootPath = "";
  const result = await invoke(["--store-root", "query-store", "query", "请求"], {
    async query(root, received) {
      rootPath = root.rootPath;
      request = received;
      return { mode: "keyword", results: [] };
    },
  });
  expect(rootPath).toMatch(/query-store$/);
  expect(request).toEqual({ text: "请求" });
  expect(result.exitCode).toBe(0);
});

test("delegates query-domain validation to Engine before Store I/O", async () => {
  let reads = 0;
  const result = await invoke(
    ["query", "   "],
    createQueryService({
      store: {
        async readSnapshotIdentity() {
          reads++;
          return {
            rootBinding: "unused",
            generation: 0,
            effectiveRevision: 0,
            manifestDigest: "unused",
          };
        },
        async readEffectivePracticeSnapshot() {
          return {
            identity: {
              rootBinding: "unused",
              generation: 0,
              effectiveRevision: 0,
              manifestDigest: "unused",
            },
            practices: [],
          };
        },
        async readEffectivePracticeChanges() {
          return undefined;
        },
        async readEffectivePracticesAtSnapshot() {
          return [];
        },
      },
    }),
  );
  expect(reads).toBe(0);
  expect(result.exitCode).toBe(2);
  expect(result.response.error.code).toBe("usage.invalid");
});

test.each(["1.5", "+2", "2x", ""])(
  'rejects non-decimal --top-k "%s" before QueryService',
  async (topK) => {
    let calls = 0;
    const result = await invoke(["query", "text", "--top-k", topK], {
      async query() {
        calls++;
        return queryResult;
      },
    });
    expect(calls).toBe(0);
    expect(result.exitCode).toBe(2);
    expect(result.response.error).toEqual({
      code: "usage.invalid",
      message: "The command invocation is invalid.",
    });
  },
);

test("maps Engine query validation and retrieval failures to public CLI codes", async () => {
  for (const [error, code] of [
    [new InvalidQueryRequestError(), "usage.invalid"],
    [new KeywordIndexUnavailableError(), "query.unavailable"],
    [new KeywordIndexError(), "query.failed"],
    [new StoreBusyError("internal-path"), "store.busy"],
    [new StoreRecoveryRequiredError("internal-path"), "store.recovery-required"],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- each case must exercise its own mapped error
    const result = await invoke(["query", "text"], {
      async query() {
        throw error;
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.response.error.code).toBe(code);
    expect(JSON.stringify(result.response)).not.toContain("internal-path");
  }
});

test("maps undeclared query failures without exposing details", async () => {
  const result = await invoke(["query", "text"], {
    async query() {
      throw new CliError("undeclared.error", "internal-path");
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error.code).toBe("runtime.unexpected");
  expect(JSON.stringify(result.response)).not.toContain("internal-path");
});

test("publishes query arguments, schema, error allowlist, and exit codes through discovery", () => {
  const definition = createQueryCommand({
    queryService: {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    storageRoot: { rootPath: "unused-default" },
  });
  const description = describeCommand("query", [definition]);
  expect(description).toMatchObject({
    name: "query",
    usage: "query <text>",
    positionals: [{ name: "text", required: true }],
    errorCodes: definition.errorCodes,
    exitCodes: [0, 2],
    resultSchema: definition.resultSchema,
  });
  expect(
    (description as { options: readonly { name: string }[] }).options.some(
      (option) => option.name === "--top-k <n>",
    ),
  ).toBe(true);
});
