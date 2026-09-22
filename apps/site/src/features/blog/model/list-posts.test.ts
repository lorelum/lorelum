import { describe, expect, test } from "bun:test";
import type { BlogPostRecord } from "./list-posts";
import { buildBlogIndex, filterBlogIndex, type BlogIndexOptions } from "./list-posts";

/**
 * The environment the index is built for. Production is the default here because
 * the existing expectations are the published-index ones; the development case
 * has its own test below.
 */
const production: BlogIndexOptions = { isDevelopment: false };
const development: BlogIndexOptions = { isDevelopment: true };

function record(
  slug: string,
  locale: string,
  overrides: Partial<BlogPostRecord["data"]> = {},
): BlogPostRecord {
  return {
    slug,
    locale,
    data: {
      title: `${slug} (${locale})`,
      description: "A factual one-sentence summary.",
      date: "2026-09-18",
      category: "benchmark",
      author: "Yuchao Huang",
      draft: false,
      ...overrides,
    },
  };
}

describe("buildBlogIndex", () => {
  test("prefers the requested locale's file when both exist", () => {
    const index = buildBlogIndex(
      [record("post-a", "en"), record("post-a", "zh")],
      "zh",
      production,
    );

    expect(index).toHaveLength(1);
    expect(index[0]?.locale).toBe("zh");
  });

  test("falls back to the file in the other locale, and says which language it is", () => {
    const index = buildBlogIndex([record("post-a", "en")], "zh", production);

    expect(index).toHaveLength(1);
    expect(index[0]?.locale).toBe("en");
  });

  test("excludes drafts but keeps a published version in the other locale", () => {
    const index = buildBlogIndex(
      [record("post-a", "zh", { draft: true }), record("post-a", "en")],
      "zh",
      production,
    );

    expect(index).toHaveLength(1);
    expect(index[0]?.locale).toBe("en");
  });

  test("drops a slug entirely when every locale's version is a draft", () => {
    const index = buildBlogIndex(
      [record("post-a", "en", { draft: true }), record("post-a", "zh", { draft: true })],
      "en",
      production,
    );

    expect(index).toHaveLength(0);
  });

  test("lists a draft while developing, because its own URL answers there", () => {
    // The index and the article URL must give the same answer about a draft, so
    // this test and `loadBlogPost` share one predicate and one environment input.
    // Before this, the dev index hid drafts while the dev article URL served them.
    const records = [
      record("post-a", "en", { draft: true }),
      record("post-b", "en"),
      record("post-a", "zh", { draft: true }),
    ];

    const developing = buildBlogIndex(records, "en", development);
    const shipped = buildBlogIndex(records, "en", production);

    expect(developing.map((entry) => entry.slug)).toEqual(["post-a", "post-b"]);
    expect(shipped.map((entry) => entry.slug)).toEqual(["post-b"]);
    // A draft that only exists in the other locale is listed there too — the
    // environment decision is the same one, applied per record.
    expect(developing.find((entry) => entry.slug === "post-a")?.locale).toBe("en");
  });

  test("sorts by date descending, then slug ascending", () => {
    const index = buildBlogIndex(
      [
        record("post-b", "en", { date: "2026-09-01" }),
        record("post-c", "en", { date: "2026-09-18" }),
        record("post-a", "en", { date: "2026-09-18" }),
        record("post-d", "en", { date: "2026-08-31" }),
      ],
      "en",
      production,
    );

    expect(index.map((entry) => entry.slug)).toEqual(["post-a", "post-c", "post-b", "post-d"]);
  });

  test("is deterministic regardless of input order", () => {
    const records = [
      record("post-a", "en", { date: "2026-09-10" }),
      record("post-b", "en", { date: "2026-09-12" }),
      record("post-a", "zh", { date: "2026-09-10" }),
      record("post-b", "zh", { date: "2026-09-12" }),
    ];

    const forward = buildBlogIndex(records, "en", production);
    const reversed = buildBlogIndex([...records].reverse(), "en", production);

    expect(forward).toEqual(reversed);
    expect(forward.map((entry) => entry.slug)).toEqual(["post-b", "post-a"]);
  });
});

describe("filterBlogIndex", () => {
  const entries = buildBlogIndex(
    [
      record("post-a", "en", { category: "benchmark" }),
      record("post-b", "en", { category: "packs" }),
      record("post-c", "en", { category: "benchmark" }),
    ],
    "en",
    production,
  );

  test("keeps only the requested category", () => {
    expect(filterBlogIndex(entries, "benchmark").map((entry) => entry.slug)).toEqual([
      "post-a",
      "post-c",
    ]);
    expect(filterBlogIndex(entries, "packs").map((entry) => entry.slug)).toEqual(["post-b"]);
  });

  test("returns every entry for the empty filter", () => {
    expect(filterBlogIndex(entries, undefined)).toEqual(entries);
  });

  test("does not mutate the index it was given", () => {
    const before = entries.map((entry) => entry.slug);

    filterBlogIndex(entries, "packs");

    expect(entries.map((entry) => entry.slug)).toEqual(before);
  });

  test("returns a copy even when nothing is filtered out", () => {
    const unfiltered = filterBlogIndex(entries, undefined);

    expect(unfiltered).not.toBe(entries);
  });
});
