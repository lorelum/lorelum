import { expect, test } from "bun:test";

import {
  createFailureEnvelope,
  createSuccessEnvelope,
  protocolResponseSchema,
  protocolVersion,
  toolVersion,
} from "./protocol.js";
import { composeDiagnostics, createInvocationNotice } from "./notices.js";
import goldenEnvelopes from "./protocol-envelope.fixture.json";
import { validateProtocolSchema } from "./protocol-schema.test-helper.js";

const traceId = "00000000-0000-4000-8000-000000000001" as never;

const fallbackNotice = createInvocationNotice({
  kind: "configuration",
  subject: "logging.level",
  reason: "invalid-value",
  received: "noisy",
  expected: { kind: "enum", values: ["error", "warn", "info", "debug"] },
  effective: "info",
  source: "/home/example/.lorelum/config.yaml",
});

test("creates structured protocol success envelopes", () => {
  const response = createSuccessEnvelope("describe", { name: "lore" }, { traceId });

  expect(response).toEqual({
    protocolVersion,
    toolVersion,
    command: "describe",
    diagnostics: { traceId },
    ok: true,
    data: { name: "lore" },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
});

test("rejects non-JSON-safe success data before rendering", () => {
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
    expect(() => createSuccessEnvelope("invalid", value as never, { traceId })).toThrow();
  }
});

test("creates structured protocol failures", () => {
  const response = createFailureEnvelope(
    "unknown",
    "usage.invalid",
    "The command invocation is invalid.",
    undefined,
    { traceId },
  );

  expect(response).toMatchObject({
    protocolVersion,
    command: "unknown",
    diagnostics: { traceId },
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
    { traceId },
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
      { protocolVersion, toolVersion, command: "describe", ok: true },
      protocolResponseSchema,
    ),
  ).not.toEqual([]);
  expect(
    validateProtocolSchema(
      {
        protocolVersion: 1,
        toolVersion,
        command: "describe",
        diagnostics: { traceId },
        ok: true,
        data: {},
        extra: true,
      },
      protocolResponseSchema,
    ),
  ).not.toEqual([]);
});

test("carries invocation notices in success and failure diagnostics", () => {
  const success = createSuccessEnvelope(
    "describe",
    {},
    composeDiagnostics(traceId, [fallbackNotice]),
  );
  expect(success.diagnostics).toEqual({ traceId, notices: [fallbackNotice] });
  expect(validateProtocolSchema(success, protocolResponseSchema)).toEqual([]);

  const failure = createFailureEnvelope(
    "unknown",
    "usage.invalid",
    "The command invocation is invalid.",
    undefined,
    composeDiagnostics(traceId, [fallbackNotice]),
  );
  expect(failure.diagnostics?.notices?.[0]?.subject).toBe("logging.level");
  expect(validateProtocolSchema(failure, protocolResponseSchema)).toEqual([]);
});

test("composeDiagnostics keeps the legacy shape without notices", () => {
  expect(composeDiagnostics(traceId)).toEqual({ traceId });
  expect(composeDiagnostics(traceId, [])).toEqual({ traceId });
});

test("rejects malformed notice diagnostics with the exported JSON Schema", () => {
  const malformed: unknown[] = [
    { traceId, notices: [] },
    {
      traceId,
      notices: [{ kind: "privacy", subject: "logging.level", reason: "invalid-value" }],
    },
    {
      traceId,
      notices: [{ kind: "configuration", subject: "logging.level", reason: "nope" }],
    },
    {
      traceId,
      notices: [
        { kind: "configuration", subject: "logging.level", reason: "invalid-value", extra: true },
      ],
    },
    {
      traceId,
      notices: [
        {
          kind: "configuration",
          subject: "logging.level",
          reason: "invalid-value",
          expected: { kind: "regex" },
        },
      ],
    },
  ];
  for (const diagnostics of malformed) {
    const response = {
      protocolVersion,
      toolVersion,
      command: "describe",
      diagnostics,
      ok: true,
      data: {},
    };
    expect(validateProtocolSchema(response, protocolResponseSchema)).not.toEqual([]);
  }
});
