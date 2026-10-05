import { describe, expect, test } from "bun:test";
import { featuredTitleParts, keepTitlePartTogether } from "./featured-title";

describe("featured title break opportunities", () => {
  test("preserves the complete real title while keeping engineering terms intact", () => {
    const title = "我们如何改进测评系统，实现对 Practice 注入效果的可信测量";
    const parts = featuredTitleParts(title);
    expect(parts.join("")).toBe(title);
    expect(parts.filter(keepTitlePartTogether)).toEqual(["系统，", "Practice", "注入", "测量"]);
    expect(keepTitlePartTogether("系统，")).toBe(true);
  });

  test("does not turn an arbitrary unbreakable hostile title into a fixed-width atom", () => {
    const title = "unbreakable".repeat(100);
    expect(featuredTitleParts(title)).toEqual([title]);
    expect(keepTitlePartTogether(title)).toBe(false);
  });

  test("preserves repeated terms, punctuation, whitespace and an absent title", () => {
    for (const title of ["", "系统系统", "Practice & Practice", "  测量，结果  ", "A measured system"]) {
      expect(featuredTitleParts(title).join("")).toBe(title);
    }
    expect(keepTitlePartTogether("practice")).toBe(false);
  });
});
