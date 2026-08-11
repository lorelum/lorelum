import { expect, test } from "bun:test";

import { ConditionSyntaxError, evaluateCondition } from "./when.js";

test("evaluates supported literals, comparison, boolean operators, and parentheses", () => {
  const context = {
    featureFlags: { experimental: false },
    state: { client: "heavy", retries: 3 },
  };

  expect(
    evaluateCondition(
      'state.client == "heavy" && (state.retries != 2 || !featureFlags.experimental)',
      context,
    ),
  ).toBe(true);
  expect(evaluateCondition("state.retries == 3 && true", context)).toBe(true);
  expect(evaluateCondition("state.retries == 3.5", context)).toBe(false);
});

test("uses ordinary numeric equality semantics", () => {
  expect(evaluateCondition("state.value == 0", { state: { value: -0 } })).toBe(true);
});

test("treats missing paths and incompatible comparisons as false", () => {
  const context = { state: { client: "heavy" } };

  expect(evaluateCondition('state.server == "heavy"', context)).toBe(false);
  expect(evaluateCondition("!featureFlags.experimental", context)).toBe(false);
  expect(evaluateCondition("state.client == 1", context)).toBe(false);
});

test("rejects syntax outside the v1 condition language", () => {
  expect(() => evaluateCondition('state.client = "heavy"', {})).toThrow(ConditionSyntaxError);
  expect(() => evaluateCondition("state.client()", {})).toThrow(ConditionSyntaxError);
  expect(() => evaluateCondition("(state.client == 'heavy'", {})).toThrow(ConditionSyntaxError);
});

test("rejects conditions beyond the nesting limit", () => {
  const source = "(".repeat(129) + "true" + ")".repeat(129);
  expect(() => evaluateCondition(source, {})).toThrow(ConditionSyntaxError);
});

test("rejects flat logical chains beyond the binary operator limit", () => {
  // 1025 operators exceeds the 1024 cap; parsing must reject it as a syntax
  // error instead of overflowing the call stack during evaluation.
  const source = Array.from({ length: 1026 }, () => "true").join(" && ");
  expect(() => evaluateCondition(source, {})).toThrow(ConditionSyntaxError);
});

test("rejects long || chains beyond the binary operator limit", () => {
  const source = Array.from({ length: 1026 }, () => "false").join(" || ");
  expect(() => evaluateCondition(source, {})).toThrow(ConditionSyntaxError);
});

test("accepts flat logical chains within the binary operator limit", () => {
  const source = Array.from({ length: 1025 }, () => "true").join(" && ");
  expect(evaluateCondition(source, {})).toBe(true);
});
