import { describe, expect, test } from "bun:test";
import { blogFrontmatterSchema } from "./frontmatter";

const valid = {
  title: "How we improved our evaluation system",
  description: "A factual one-sentence summary of the post.",
  date: "2026-09-18",
  category: "benchmark",
  author: "Yuchao Huang",
};

describe("blogFrontmatterSchema", () => {
  test("accepts a complete frontmatter and defaults draft to false", () => {
    const result = blogFrontmatterSchema.safeParse(valid);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.draft).toBe(false);
      expect(result.data.updated).toBeUndefined();
    }
  });

  test("accepts optional updated and explicit draft", () => {
    const result = blogFrontmatterSchema.safeParse({
      ...valid,
      updated: "2026-09-20",
      draft: true,
    });

    expect(result.success).toBe(true);
  });

  test("rejects an impossible calendar date", () => {
    const result = blogFrontmatterSchema.safeParse({ ...valid, date: "2026-02-30" });

    expect(result.success).toBe(false);
  });

  test("rejects a date that is not YYYY-MM-DD", () => {
    for (const date of ["2026-9-18", "18-09-2026", "2026/09/18", ""]) {
      const result = blogFrontmatterSchema.safeParse({ ...valid, date });
      expect(result.success).toBe(false);
    }
  });

  test("rejects an unknown category", () => {
    const result = blogFrontmatterSchema.safeParse({ ...valid, category: "news" });

    expect(result.success).toBe(false);
  });

  test("rejects an empty title, description, or author", () => {
    for (const key of ["title", "description", "author"] as const) {
      const result = blogFrontmatterSchema.safeParse({ ...valid, [key]: "" });
      expect(result.success).toBe(false);
    }
  });
});
