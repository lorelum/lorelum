import { expect, test } from "bun:test";

import { protocolResponseSchema, renderFailure, renderSuccess, toolVersion } from "./protocol.js";
import goldenResponses from "./protocol.fixture.json";
import { validateProtocolSchema } from "./protocol-schema.js";

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

test("validates golden success and failure envelopes with the exported JSON Schema", () => {
  for (const response of goldenResponses) {
    expect(response.toolVersion).toBe(toolVersion);
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
