import { expect, test } from "bun:test";

import { run } from "./main.js";
import { protocolResponseSchema, toolVersion, type JsonSchema } from "./output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "./output/protocol-schema.test-helper.js";
import { describeCommand } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("returns machine-readable root capability discovery", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run([], { stderr, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: {
      name: "lore",
      commands: [{ name: "describe" }],
    },
  });
  expect(stderr.value).toBe("");
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, resultSchemaFor("lore"))).toEqual([]);
  expect(
    validateJsonSchema({ ...response.data, commands: "describe" }, resultSchemaFor("lore")),
  ).not.toEqual([]);
});

test("returns command metadata through describe", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["describe", "describe"], { stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "describe",
      resultSchema: { oneOf: expect.any(Array) },
      errorCodes: ["usage.invalid", "runtime.unexpected"],
      exitCodes: [0, 2],
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, resultSchemaFor("describe"))).toEqual([]);
  expect(
    validateJsonSchema({ ...response.data, exitCodes: ["0", "2"] }, resultSchemaFor("describe")),
  ).not.toEqual([]);
});

function resultSchemaFor(command: string): JsonSchema {
  const description = describeCommand(command) as { resultSchema?: JsonSchema } | undefined;
  if (description?.resultSchema === undefined) {
    throw new Error(`Missing result schema for ${command}`);
  }
  return description.resultSchema;
}

function optionResultSchemaFor(command: string, behavior: string): JsonSchema {
  const description = describeCommand(command) as
    | {
        options?: readonly {
          behavior?: string;
          response?: { resultSchema?: JsonSchema };
        }[];
      }
    | undefined;
  const schema = description?.options?.find((option) => option.behavior === behavior)?.response
    ?.resultSchema;
  if (schema === undefined) {
    throw new Error(`Missing ${behavior} result schema for ${command}`);
  }
  return schema;
}

test("returns structured help and version responses", async () => {
  const help = new MemoryWriter();
  const version = new MemoryWriter();

  expect(await run(["describe", "--help"], { stdout: help })).toBe(0);
  expect(JSON.parse(help.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: { name: "describe" },
  });
  expect(validateProtocolSchema(JSON.parse(help.value), protocolResponseSchema)).toEqual([]);

  expect(await run(["--version"], { stdout: version })).toBe(0);
  const versionResponse = JSON.parse(version.value);
  expect(versionResponse).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "version",
    ok: true,
    data: { protocolVersion: 1, toolVersion },
  });
  expect(validateProtocolSchema(versionResponse, protocolResponseSchema)).toEqual([]);
  const versionResultSchema = optionResultSchemaFor("lore", "version");
  expect(validateJsonSchema(versionResponse.data, versionResultSchema)).toEqual([]);
  expect(validateJsonSchema({ protocolVersion: 1 }, versionResultSchema)).not.toEqual([]);
});

test("accepts the documented equals form of global options", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["--log-level=debug"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "describe", ok: true });
});

test("validates invalid calls before help and version responses", async () => {
  const invalidCalls = [
    ["unknown", "--help"],
    ["describe", "unknown", "--help"],
    ["unknown", "--version"],
    ["--help", "--version"],
    ["describe", "--version"],
    ["--log-level"],
    ["--private-token"],
  ];
  await Promise.all(
    invalidCalls.map(async (args) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(args, { stderr, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        ok: false,
        error: { code: "usage.invalid", message: "The command invocation is invalid." },
      });
      expect(stdout.value).not.toContain("private-token");
      expect(stderr.value).toBe("");
      expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
    }),
  );
});
