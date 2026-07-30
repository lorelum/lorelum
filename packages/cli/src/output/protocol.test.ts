import { expect, test } from "bun:test";

import { protocolResponseSchema, renderFailure, renderSuccess, toolVersion } from "./protocol.js";
import goldenEnvelopes from "./protocol-envelope.fixture.json";
import { validateProtocolSchema } from "./protocol-schema.test-helper.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("renders one JSON line for successful protocol responses", () => {
  const writer = new MemoryWriter();

  renderSuccess(writer, "describe", { name: "lore" });

  expect(writer.value.endsWith("\n")).toBe(true);
  expect(JSON.parse(writer.value)).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: { name: "lore" },
  });
  expect(validateProtocolSchema(JSON.parse(writer.value), protocolResponseSchema)).toEqual([]);
});

test("rejects non-JSON-safe success data before writing", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const invalidValues: unknown[] = [
    undefined,
    { nested: undefined },
    Number.NaN,
    1n,
    new Date(0),
    circular,
  ];

  for (const value of invalidValues) {
    const writer = new MemoryWriter();
    expect(() => renderSuccess(writer, "invalid", value as never)).toThrow();
    expect(writer.value).toBe("");
  }
});

test("renders structured protocol failures", () => {
  const writer = new MemoryWriter();

  renderFailure(writer, "unknown", "usage.invalid", "The command invocation is invalid.");

  expect(JSON.parse(writer.value)).toMatchObject({
    command: "unknown",
    ok: false,
    error: { code: "usage.invalid" },
  });
  expect(validateProtocolSchema(JSON.parse(writer.value), protocolResponseSchema)).toEqual([]);
});

test("validates independent golden envelopes with the exported envelope schema", () => {
  for (const response of goldenEnvelopes) {
    expect(response.toolVersion).toBe(toolVersion);
    expect(response.command).toStartWith("fixture.");
    expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  }
});

test("rejects malformed envelopes with the exported JSON Schema", () => {
  expect(
    validateProtocolSchema(
      { protocolVersion: 1, toolVersion, command: "describe", ok: true },
      protocolResponseSchema,
    ),
  ).not.toEqual([]);
  expect(
    validateProtocolSchema(
      {
        protocolVersion: 1,
        toolVersion,
        command: "describe",
        ok: true,
        data: {},
        extra: true,
      },
      protocolResponseSchema,
    ),
  ).not.toEqual([]);
});
