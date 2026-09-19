import { describe, expect, test } from "bun:test";
import type { BlogPostRecord } from "./list-posts";
import { buildBlogIndex } from "./list-posts";

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
  test("prefers the requested locale and marks it as translated", () => {
    const index = buildBlogIndex([record("post-a", "en"), record("post-a", "zh")], "zh");

    expect(index).toHaveLength(1);
    expect(index[0]?.locale).toBe("zh");
    expect(index[0]?.translated).toBe(false);
  });

  test("falls back to the other locale with a translated marker", () => {
    const index = buildBlogIndex([record("post-a", "en")], "zh");

    expect(index).toHaveLength(1);
    expect(index[0]?.locale).toBe("en");
    expect(index[0]?.translated).toBe(true);
  });

  test("excludes drafts but keeps a published version in the other locale", () => {
    const index = buildBlogIndex(
      [record("post-a", "zh", { draft: true }), record("post-a", "en")],
      "zh",
    );

    expect(index).toHaveLength(1);
    expect(index[0]?.locale).toBe("en");
    expect(index[0]?.translated).toBe(true);
  });

  test("drops a slug entirely when every locale's version is a draft", () => {
    const index = buildBlogIndex(
      [record("post-a", "en", { draft: true }), record("post-a", "zh", { draft: true })],
      "en",
    );

    expect(index).toHaveLength(0);
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

    const forward = buildBlogIndex(records, "en");
    const reversed = buildBlogIndex([...records].reverse(), "en");

    expect(forward).toEqual(reversed);
    expect(forward.map((entry) => entry.slug)).toEqual(["post-b", "post-a"]);
  });
});
