import { expect, test } from "bun:test";
import {
  createErrorDetail,
  errorDetailBudgets,
  formatErrorDetail,
  sanitizeErrorDetails,
} from "./error-details.js";
test("constrains valid details without changing validator-owned facts", () => {
  const detail = createErrorDetail({
    kind: "configuration",
    subject: "query.maxWaitMs",
    reason: "invalid-type",
    source: { kind: "config-file" },
    received: "nope",
    expected: { kind: "integer-range", min: 0, max: 120_000 },
    hint: "Fix or remove this setting in ~/.lorelum/config.yaml.",
    location: { line: 2, column: 3 },
  });
  expect(detail).toEqual({
    kind: "configuration",
    subject: "query.maxWaitMs",
    reason: "invalid-type",
    source: { kind: "config-file" },
    received: "nope",
    expected: { kind: "integer-range", min: 0, max: 120_000 },
    hint: "Fix or remove this setting in ~/.lorelum/config.yaml.",
    location: { line: 2, column: 3 },
  });
});
test("truncates by code point and escapes terminal controls deterministically", () => {
  const raw = `a\r\nb\u001b[2J\u202e${"x".repeat(errorDetailBudgets.receivedMaxLength)}`;
  const detail = createErrorDetail({
    kind: "configuration",
    subject: "query.maxWaitMs",
    reason: "invalid-type",
    received: raw,
  });
  expect(detail.received).not.toContain("\r");
  expect(detail.received).not.toContain("\n");
  expect(detail.received).not.toContain("\u001b");
  expect(detail.received).not.toContain("\u202e");
  expect(detail.received).toContain("a\\u000d\\u000ab\\u001b[2J\\u202e");
  expect(detail.received).toEndWith("...");
  const text = formatErrorDetail(detail);
  expect(text.split(/\r|\n/)).toHaveLength(1);
});
test("keeps control-heavy received values inside the schema budget", () => {
  const detail = createErrorDetail({
    kind: "configuration",
    subject: "query.maxWaitMs",
    reason: "invalid-type",
    received: "\u001b".repeat(errorDetailBudgets.receivedMaxLength * 2),
  });

  expect(detail.received?.length).toBeLessThanOrEqual(errorDetailBudgets.receivedMaxLength);
  expect(detail.received).toEndWith("...");
});

test("rejects sources that do not match their discriminated kind", () => {
  const base = { kind: "usage", subject: "--x", reason: "missing" } as const;
  expect(
    sanitizeErrorDetails([{ ...base, source: { kind: "config-file", name: "x" } }]),
  ).toBeUndefined();
  expect(
    sanitizeErrorDetails([{ ...base, source: { kind: "command-line", name: "x" } }]),
  ).toBeUndefined();
  expect(
    sanitizeErrorDetails([{ ...base, source: { kind: "environment-variable" } }]),
  ).toBeUndefined();
  expect(
    sanitizeErrorDetails([{ ...base, source: { kind: "environment-variable", name: "VAR" } }]),
  ).toEqual([{ ...base, source: { kind: "environment-variable", name: "VAR" } }]);
});

test("accepts safe negative integer-range expectations", () => {
  const detail = createErrorDetail({
    kind: "usage",
    subject: "--offset",
    reason: "out-of-range",
    expected: { kind: "integer-range", min: -100, max: 100 },
  });

  expect(detail.expected).toEqual({ kind: "integer-range", min: -100, max: 100 });
});

test("defensively drops invalid details and omits an empty list", () => {
  const valid = createErrorDetail({
    kind: "usage",
    subject: "--min-coverage-percent",
    reason: "out-of-range",
  });
  expect(sanitizeErrorDetails([valid])).toEqual([valid]);
  expect(sanitizeErrorDetails([])).toBeUndefined();
  expect(
    sanitizeErrorDetails([{ kind: "invalid" as never, subject: "--x", reason: "missing" }]),
  ).toBeUndefined();
  expect(
    sanitizeErrorDetails([
      {
        kind: "usage",
        subject: "--x",
        reason: "out-of-range",
        expected: { kind: "integer-range", min: 10, max: -1 },
      },
    ]),
  ).toBeUndefined();
  expect(
    sanitizeErrorDetails([
      { kind: "usage", subject: "--x", reason: "missing", location: { line: 0, column: 1 } },
    ]),
  ).toBeUndefined();
});
