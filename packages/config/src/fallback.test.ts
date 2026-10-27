import { expect, test } from "bun:test";

import { ConfigError } from "./failure.js";
import { resolveConfigWithFallback } from "./fallback.js";

const failure = new ConfigError({
  kind: "setting",
  source: { kind: "override", label: "display override" },
  subject: "display.pageSize",
  reason: "range",
  rule: { kind: "integer", minimum: 1, maximum: 100 },
});

test("strict consumers propagate the original configuration error", async () => {
  const load = () => Promise.reject(failure);
  await expect(load()).rejects.toBe(failure);
});

test("uses the explicit fallback and returns the original configuration error", async () => {
  let calls = 0;
  const result = await resolveConfigWithFallback(async () => {
    calls += 1;
    throw failure;
  }, 20);

  expect(calls).toBe(1);
  expect(result).toEqual({ kind: "fallback", value: 20, error: failure });
});

test("returns the configured value without changing it", async () => {
  await expect(resolveConfigWithFallback(async () => 10, 20)).resolves.toEqual({
    kind: "configured",
    value: 10,
  });
});

test("does not catch unrelated errors", async () => {
  const error = new TypeError("unexpected");
  await expect(
    resolveConfigWithFallback(async () => {
      throw error;
    }, 20),
  ).rejects.toBe(error);
});
