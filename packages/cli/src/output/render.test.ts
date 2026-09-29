import { expect, test } from "bun:test";

import { protocolResponseSchema, toolVersion } from "./protocol.js";
import { renderResult } from "./render.js";
import { validateProtocolSchema } from "./protocol-schema.test-helper.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("renders JSON success as the complete existing protocol envelope", () => {
  const writer = new MemoryWriter();

  renderResult(writer, "json", {
    kind: "success",
    command: "fixture.success",
    data: { source: { id: "source-1" }, values: [1, null] },
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000001" as never },
  });

  const response = JSON.parse(writer.value);
  expect(response).toEqual({
    protocolVersion: 2,
    toolVersion,
    command: "fixture.success",
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000001" },
    ok: true,
    data: { source: { id: "source-1" }, values: [1, null] },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
});

test("renders complete default text without a command-specific projection", () => {
  const writer = new MemoryWriter();

  renderResult(writer, "text", {
    kind: "success",
    command: "fixture.success",
    data: { state: "partial", operationId: "operation-1", warnings: [] },
  });

  expect(writer.value).toBe(`state: partial
operationId: operation-1
warnings: []
`);
});

test("custom layout receives the complete data and pure fallback", () => {
  const writer = new MemoryWriter();

  renderResult(writer, "text", {
    kind: "success",
    command: "fixture.custom",
    data: { title: "Readable", source: { id: "source-1" } },
    textRenderer: (data, fallback) => `Heading: Readable\n${fallback(data)}`,
  });

  expect(writer.value).toContain("Heading: Readable");
  expect(writer.value).toContain("source:");
  expect(writer.value).toContain("id: source-1");
});

test("renders a default text error with every public error field", () => {
  const writer = new MemoryWriter();

  renderResult(writer, "text", {
    kind: "failure",
    command: "query",
    code: "backend.build-mismatch",
    message: "A different Lorelum build owns the local backend.",
    recovery: {
      action: "backend.stop-if-idle",
      automation: "auto",
      reason: "idle",
      retry: "original-command",
    },
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000002" as never },
  });

  expect(writer.value).toBe(`error:
  code: backend.build-mismatch
  message: A different Lorelum build owns the local backend.
  recovery:
    action: backend.stop-if-idle
    automation: auto
    reason: idle
    retry: original-command
diagnostics:
  traceId: 00000000-0000-4000-8000-000000000002
`);
});

test("renders the same bounded, terminal-safe failure message in both formats", () => {
  const raw = `Invalid --value \u001b[2J\u202e${"x".repeat(500)}`;
  const jsonWriter = new MemoryWriter();
  const textWriter = new MemoryWriter();
  const result = {
    kind: "failure" as const,
    command: "query",
    code: "usage.invalid",
    message: raw,
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000004" as never },
  };

  renderResult(jsonWriter, "json", result);
  renderResult(textWriter, "text", result);

  const message = JSON.parse(jsonWriter.value).error.message as string;
  expect(message).toContain("\\u001b[2J\\u202e");
  expect(message).toEndWith("...");
  expect(message.length).toBeLessThanOrEqual(400);
  expect(textWriter.value).toContain(message);
  expect(textWriter.value).not.toContain("\u001b");
  expect(textWriter.value).not.toContain("\u202e");
  expect(validateProtocolSchema(JSON.parse(jsonWriter.value), protocolResponseSchema)).toEqual([]);
});

test("renders JSON failures as one envelope with the supplied trace", () => {
  const writer = new MemoryWriter();

  renderResult(writer, "json", {
    kind: "failure",
    command: "query",
    code: "backend.unavailable",
    message: "The local backend is unavailable.",
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000003" as never },
  });

  expect(JSON.parse(writer.value)).toMatchObject({
    command: "query",
    ok: false,
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000003" },
    error: { code: "backend.unavailable" },
  });
  expect(writer.value.split("\n")).toEqual([expect.any(String), ""]);
});

test("rejects non-JSON-safe data before writing either format", () => {
  const writer = new MemoryWriter();
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  expect(() =>
    renderResult(writer, "text", {
      kind: "success",
      command: "invalid",
      data: circular as never,
    }),
  ).toThrow();
  expect(writer.value).toBe("");
});
