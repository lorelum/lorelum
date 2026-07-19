import { describe, expect, test } from "bun:test";

import { buildReport, issue } from "./report";

describe("buildReport", () => {
  test("empty issue list → valid report with empty buckets", () => {
    const r = buildReport([]);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.infos).toEqual([]);
  });

  test("buckets issues by level", () => {
    const r = buildReport([
      issue("error", "format", "name", "bad"),
      issue("warning", "missing-severity", "practices[0].severity", "x"),
      issue("info", "small-pack", "practices", "y"),
      issue("error", "dangling-ref", "decisions[0]", "z"),
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.infos).toHaveLength(1);
  });

  test("warnings and infos do not affect validity", () => {
    const r = buildReport([
      issue("warning", "missing-severity", "x", "y"),
      issue("info", "small-pack", "x", "y"),
    ]);
    expect(r.valid).toBe(true);
  });
});
