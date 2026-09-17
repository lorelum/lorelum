import { expect, test } from "bun:test";

import {
  createFailureEnvelope,
  createSuccessEnvelope,
  protocolResponseSchema,
  toolVersion,
} from "./protocol.js";
import goldenEnvelopes from "./protocol-envelope.fixture.json";
import { validateProtocolSchema } from "./protocol-schema.test-helper.js";

test("creates structured protocol success envelopes", () => {
  const response = createSuccessEnvelope("describe", { name: "lore" });

  expect(response).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: { name: "lore" },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
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
    expect(() => createSuccessEnvelope("invalid", value as never)).toThrow();
  }
});

test("creates structured protocol failures", () => {
  const response = createFailureEnvelope(
    "unknown",
    "usage.invalid",
    "The command invocation is invalid.",
  );

  expect(response).toMatchObject({
    command: "unknown",
    ok: false,
    error: { code: "usage.invalid" },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
});

test("creates optional machine recovery without widening unrelated failures", () => {
  const response = createFailureEnvelope(
    "query",
    "backend.build-mismatch",
    "A different Lorelum build owns the local backend.",
    {
      action: "backend.stop-if-idle",
      automation: "auto",
      reason: "idle",
      retry: "original-command",
    },
  );
  expect(response).toMatchObject({
    error: {
      code: "backend.build-mismatch",
      recovery: {
        action: "backend.stop-if-idle",
        automation: "auto",
        reason: "idle",
        retry: "original-command",
      },
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
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
