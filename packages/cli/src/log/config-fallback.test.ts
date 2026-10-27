import { expect, test } from "bun:test";
import { ConfigError, type ConfigFailure } from "@lorelum/config";
import { isSameDocumentFailure, loggingFallbackNotice } from "./config-fallback.js";

const syntax: ConfigFailure = {
  kind: "document",
  source: { kind: "file", path: "/example/config.yaml" },
  reason: "yaml-syntax",
  location: { line: 2, column: 3 },
};

test("only the same classified document failure suppresses a duplicate notice", () => {
  expect(isSameDocumentFailure(syntax, { ...syntax })).toBe(true);
  expect(
    isSameDocumentFailure(syntax, {
      ...syntax,
      source: { kind: "file", path: "/example/other.yaml" },
    }),
  ).toBe(false);
  expect(isSameDocumentFailure(syntax, { ...syntax, location: { line: 3, column: 1 } })).toBe(
    false,
  );
  expect(isSameDocumentFailure(syntax, undefined)).toBe(false);
  expect(isSameDocumentFailure(undefined, undefined)).toBe(false);
  expect(
    isSameDocumentFailure(syntax, {
      kind: "setting",
      source: syntax.source,
      subject: "logging.level",
      reason: "enum",
    }),
  ).toBe(false);
});

test("fallback notices use the shared bounded terminal presentation", () => {
  const notice = loggingFallbackNotice({
    kind: "fallback",
    fallbackLevel: "info",
    effectiveLevel: "debug",
    cause: {
      kind: "config",
      error: new ConfigError({
        kind: "setting",
        source: { kind: "file", path: "/example/config.yaml" },
        subject: "logging.level",
        reason: "enum",
        rule: { kind: "enum", values: ["error", "warn", "info", "debug"] },
        receivedScalar: "noisy\n\u001b[31m\u202e",
      }),
    },
  });
  expect(notice.length).toBeLessThanOrEqual(400);
  expect(notice).toContain("effective level is debug");
  expect(notice).toContain("logging.level");
  expect(notice.includes("\n")).toBe(false);
  expect(notice.includes("\r")).toBe(false);
  expect(notice.includes("\u001b")).toBe(false);
  expect(notice.includes("\u202e")).toBe(false);
});

test("an unavailable logging reader does not invent configuration facts", () => {
  const notice = loggingFallbackNotice({
    kind: "fallback",
    fallbackLevel: "info",
    effectiveLevel: "info",
    cause: { kind: "unavailable" },
  });
  expect(notice).toContain("settings could not be applied");
  expect(notice).toContain("effective level is info");
  expect(notice).not.toContain("yaml");
  expect(notice).not.toContain("logging.level");
});
