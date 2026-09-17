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
  });

  const response = JSON.parse(writer.value);
  expect(response).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "fixture.success",
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
  });

  expect(writer.value).toBe(`error:
  code: backend.build-mismatch
  message: A different Lorelum build owns the local backend.
  recovery:
    action: backend.stop-if-idle
    automation: auto
    reason: idle
    retry: original-command
`);
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
