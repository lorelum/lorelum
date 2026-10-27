import { expect, test } from "bun:test";

import { ConfigError, configValueType, formatConfigFailure } from "./failure.js";

test("formats setting facts with the repair target and constraint before source details", () => {
  const message = formatConfigFailure({
    kind: "setting",
    source: { kind: "override", label: "resolved query settings" },
    subject: "query.maxWaitMs",
    reason: "range",
    rule: { kind: "integer", minimum: 0, maximum: 120_000 },
    receivedScalar: 200,
  });

  expect(message).toContain("query.maxWaitMs");
  expect(message).toContain("an integer from 0 through 120000");
  expect(message).toContain("Correct or remove query.maxWaitMs");
  expect(message).toContain("resolved query settings");
  expect(message).toContain("Received 200.");
  expect(message.indexOf("Correct or remove")).toBeLessThan(
    message.indexOf("resolved query settings"),
  );
  expect(message.indexOf("resolved query settings")).toBeLessThan(message.indexOf("Received 200"));
});

test("formats a caller-approved logging scalar without exposing arbitrary error text", () => {
  const error = new ConfigError({
    kind: "setting",
    source: { kind: "file", path: "/private/config.yaml" },
    subject: "logging.level",
    reason: "enum",
    rule: { kind: "enum", values: ["error", "warn", "info", "debug"] },
    receivedType: "string",
    receivedScalar: "noisy",
  });

  expect(error.message).toContain('one of "error", "warn", "info", "debug"');
  expect(error.message).toContain('Received string ("noisy").');
  expect(error.cause).toBeUndefined();
  expect(Object.hasOwn(error, "cause")).toBe(false);
});

test("classifies values without inventing a type for missing values", () => {
  expect(configValueType(undefined)).toBeUndefined();
  expect(configValueType(null)).toBe("null");
  expect(configValueType([])).toBe("array");
  expect(configValueType({})).toBe("object");
  expect(configValueType("x")).toBe("string");
  expect(configValueType(1)).toBe("number");
  expect(configValueType(false)).toBe("boolean");
  expect(configValueType(1n)).toBeUndefined();
  expect(configValueType(Symbol("x"))).toBeUndefined();
});
