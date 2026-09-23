import { describe, expect, test } from "bun:test";
import type { BlogIndexEntry } from "./list-posts";
import { defaultBlogSort, parseBlogSort, sortBlogIndex } from "./sort-posts";

const entry = (slug: string, title: string, date: string, locale = "en"): BlogIndexEntry => ({
  slug,
  locale,
  data: {
    title,
    description: `${slug} description`,
    date,
    category: "benchmark",
    author: "Lorelum",
    draft: false,
  },
});

/** As `buildBlogIndex` returns them: date descending, then slug ascending. */
const index = [
  entry("b-second", "Beta", "2026-09-18"),
  entry("a-first", "Alpha", "2026-09-18"),
  entry("old", "Gamma", "2026-01-05"),
];

describe("parseBlogSort", () => {
  test("accepts the vocabulary and falls back to the default", () => {
    expect(parseBlogSort("oldest")).toBe("oldest");
    expect(parseBlogSort("title-asc")).toBe("title-asc");
    // A shared or hand-edited link lands on a list, not on an error — the same
    // rule an unknown category follows.
    expect(parseBlogSort("sideways")).toBe(defaultBlogSort);
    expect(parseBlogSort(undefined)).toBe(defaultBlogSort);
    expect(parseBlogSort(7)).toBe(defaultBlogSort);
  });
});

describe("sortBlogIndex", () => {
  test("newest is the order the index already has", () => {
    expect(sortBlogIndex(index, "newest").map((e) => e.slug)).toEqual([
      "b-second",
      "a-first",
      "old",
    ]);
  });

  test("oldest reverses it", () => {
    expect(sortBlogIndex(index, "oldest").map((e) => e.slug)).toEqual([
      "old",
      "a-first",
      "b-second",
    ]);
  });

  test("titles sort both ways, breaking ties by slug so the order is stable", () => {
    expect(sortBlogIndex(index, "title-asc").map((e) => e.slug)).toEqual([
      "a-first",
      "b-second",
      "old",
    ]);
    expect(sortBlogIndex(index, "title-desc").map((e) => e.slug)).toEqual([
      "old",
      "b-second",
      "a-first",
    ]);
  });

  test("does not mutate the index it was given", () => {
    const before = index.map((e) => e.slug);

    sortBlogIndex(index, "oldest");
    sortBlogIndex(index, "title-desc");

    expect(index.map((e) => e.slug)).toEqual(before);
  });
});
