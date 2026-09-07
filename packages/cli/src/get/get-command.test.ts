import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  type EffectivePractice,
} from "@lorelum/engine";

import { run } from "../main.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "../output/protocol-schema.test-helper.js";
import { protocolResponseSchema } from "../output/protocol.js";
import { describeCommand, snapshotCommandDefinitions } from "../registry.js";
import { CliError } from "../runtime/errors.js";
import { createGetCommand, type GetCommandServices } from "./get-command.js";

const practice = {
  id: "sample.exact-id",
  title: "Read this Practice",
  stage: "testing",
  tech_stack: ["typescript", "bun"],
  applies_when: "when verifying a requested outcome",
  severity: "warn" as const,
  body: "## Guidance\n\nKeep the full body.\n\n```ts\nassert(outcome);\n```\n",
  anti_patterns: [],
};
const canonicalContent = JSON.stringify(practice);
const contentDigest = new Bun.CryptoHasher("sha256").update(canonicalContent).digest("hex");
const effective: EffectivePractice = {
  practiceId: practice.id,
  practice,
  canonicalContent,
  contentDigest,
  sources: [
    {
      packName: "sample",
      practiceId: practice.id,
      contentDigest,
      sourcePath: "practices/exact.md",
      canonicalPractice: { practice, canonicalContent, contentDigest },
    },
  ],
};

async function invoke(args: readonly string[], store: GetCommandServices["store"]) {
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
  const definition = createGetCommand({ store, storageRoot: { rootPath: "unused-default" } });
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

test("returns the verified snapshot once with complete content and compact provenance", async () => {
  let reads = 0;
  const result = await invoke(["get", practice.id], {
    async getEffectivePractice(root, id) {
      reads++;
      expect(root.rootPath).toBe("unused-default");
      expect(id).toBe(practice.id);
      return effective;
    },
  });
  expect(reads).toBe(1);
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual({
    practice,
    contentDigest,
    sources: [{ packName: "sample", sourcePath: "practices/exact.md" }],
  });
  expect(validateJsonSchema(result.response.data, result.definition.resultSchema)).toEqual([]);
});

test.each([
  { args: ["--store-root", "relative-store", "get", practice.id] },
  { args: ["get", practice.id, "--store-root=relative-store"] },
])("resolves explicit Store root for %j", async ({ args }) => {
  const result = await invoke(args, {
    async getEffectivePractice(root) {
      expect(root.rootPath).toBe(resolve("relative-store"));
      return effective;
    },
  });
  expect(result.exitCode).toBe(0);
});

test.each(
  [
    ["get"],
    ["get", ""],
    ["get", "sample"],
    ["get", "Sample.id"],
    ["get", "sample..id"],
    ["get", "../sample.id"],
    ["get", " sample.id"],
    ["get", "sample.id", "extra"],
    ["get", practice.id, "--store-root="],
  ].map((args) => ({ args })),
)("rejects invalid input before opening a Store: %j", async ({ args }) => {
  let opens = 0;
  const result = await invoke(args, {
    async getEffectivePractice() {
      opens++;
      throw new Error("must not open");
    },
  });
  expect(opens).toBe(0);
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "usage.invalid",
    message: "The command invocation is invalid.",
  });
});

test("does not match ID prefixes or titles", async () => {
  const result = await invoke(["get", "sample.exact"], {
    async getEffectivePractice() {
      return undefined;
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error.code).toBe("practice.not-found");
});

test.each([
  [new StoreBusyError("internal-path"), "store.busy"],
  [new StoreRecoveryRequiredError("internal-path"), "store.recovery-required"],
  [new Error("internal-path"), "runtime.unexpected"],
  [new CliError("undeclared.error", "internal-path"), "runtime.unexpected"],
] as const)("maps Store errors without exposing details: %s", async (error, code) => {
  const result = await invoke(["get", practice.id], {
    async getEffectivePractice() {
      throw error;
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error.code).toBe(code);
  expect(JSON.stringify(result.response)).not.toContain("internal-path");
});

test("publishes get arguments, schema, error allowlist, and exit codes through discovery", () => {
  const definition = createGetCommand({
    store: { getEffectivePractice: async () => undefined },
    storageRoot: { rootPath: "unused-default" },
  });
  expect(describeCommand("get")).toMatchObject({
    name: "get",
    usage: "get <practice-id>",
    positionals: [{ name: "practice-id", required: true }],
    errorCodes: definition.errorCodes,
    exitCodes: [0, 2],
    resultSchema: definition.resultSchema,
  });
});
