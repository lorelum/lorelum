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

  test("accepts an update dated on the publication day itself", () => {
    const result = blogFrontmatterSchema.safeParse({ ...valid, updated: valid.date });

    expect(result.success).toBe(true);
  });

  test("rejects an update dated before the post was published", () => {
    // `updated` is a provenance signal, so an earlier date would claim the post
    // was revised before it was written; nothing downstream can notice that.
    const result = blogFrontmatterSchema.safeParse({ ...valid, updated: "2026-09-17" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "updated")).toBe(true);
    }
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

  test.each(["yes", 1, null])("rejects a non-boolean authored draft flag: %p", (draft) => {
    expect(blogFrontmatterSchema.safeParse({ ...valid, draft }).success).toBe(false);
  });

  test("accepts an optional cover image as a site-public path", () => {
    const withImage = blogFrontmatterSchema.safeParse({
      ...valid,
      image: "/blog/covers/practice-injection-measurement.svg",
    });

    expect(withImage.success).toBe(true);
    if (withImage.success) {
      expect(withImage.data.image).toBe("/blog/covers/practice-injection-measurement.svg");
    }

    const withoutImage = blogFrontmatterSchema.safeParse(valid);
    expect(withoutImage.success).toBe(true);
    if (withoutImage.success) {
      // Absent, not defaulted: `BlogCover` branches on `undefined` to decide
      // between author art and the generated pattern.
      expect(withoutImage.data.image).toBeUndefined();
    }
  });

  test("rejects a cover image that is not a site-public path", () => {
    // Remote URLs would make the index's own layout depend on a third party,
    // and a bare word or trailing slash is not a path the app can serve.
    for (const image of [
      "",
      "covers/art.svg",
      "https://cdn.example.com/art.svg",
      "//cdn.example.com/art.svg",
      "/",
      "/blog/covers/",
    ]) {
      const result = blogFrontmatterSchema.safeParse({ ...valid, image });
      expect(result.success).toBe(false);
    }
  });
});
