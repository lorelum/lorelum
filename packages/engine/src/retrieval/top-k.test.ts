import { describe, expect, test } from "bun:test";

import { DEFAULT_TOP_K, MAX_TOP_K, MIN_TOP_K, normalizeTopK } from "./top-k.js";

describe("normalizeTopK", () => {
  test("keeps integers inside the supported range", () => {
    expect(normalizeTopK(1)).toBe(MIN_TOP_K);
    expect(normalizeTopK(5)).toBe(DEFAULT_TOP_K);
    expect(normalizeTopK(50)).toBe(MAX_TOP_K);
  });

  test("falls back to the default for non-integer values", () => {
    expect(normalizeTopK(undefined)).toBe(5);
    expect(normalizeTopK(Number.NaN)).toBe(5);
    expect(normalizeTopK(2.5)).toBe(5);
  });

  test("defensively clamps out-of-range integers", () => {
    expect(normalizeTopK(0)).toBe(1);
    expect(normalizeTopK(-3)).toBe(1);
    expect(normalizeTopK(51)).toBe(50);
    expect(normalizeTopK(500)).toBe(50);
  });
});
