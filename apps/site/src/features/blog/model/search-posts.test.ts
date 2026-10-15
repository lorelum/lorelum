import { describe, expect, test } from "bun:test";
import type { BlogIndexEntry } from "./list-posts";
import { buildBlogIndex, filterBlogIndex } from "./list-posts";
import { parseBlogQuery, searchBlogIndex } from "./search-posts";
import { sortBlogIndex } from "./sort-posts";

function entry(
  slug: string,
  title: string,
  description = "",
  category: BlogIndexEntry["data"]["category"] = "benchmark",
): BlogIndexEntry {
  return {
    slug,
    locale: "en",
    data: {
      title,
      description,
      category,
      date: "2026-09-18",
      author: "Only in author",
      draft: false,
    },
  };
}

describe("blog search query", () => {
  test("accepts only strings and treats empty whitespace as no search", () => {
    for (const value of [undefined, null, 1, true, ["Practice"], {}, "", " \t\n "]) {
      expect(parseBlogQuery(value)).toBeUndefined();
    }
    expect(parseBlogQuery("  Practice injection  ")).toBe("Practice injection");
  });

  test("bounds URL queries to the input's 200-character limit", () => {
    expect(parseBlogQuery("长".repeat(201))).toBe("长".repeat(200));
  });
});

describe("blog title and summary search", () => {
  const entries = [
    entry("measure", "Practice injection", "可信测量 and calibration"),
    entry("other", "Other title", "A different summary"),
  ];

  test("matches a title or summary without matching author metadata", () => {
    expect(searchBlogIndex(entries, "injection")).toEqual([entries[0]!]);
    expect(searchBlogIndex(entries, "可信测量")).toEqual([entries[0]!]);
    expect(searchBlogIndex(entries, "Only in author")).toEqual([]);
  });

  test("normalizes case and compatibility characters", () => {
    expect(searchBlogIndex(entries, "ＰＲＡＣＴＩＣＥ")).toEqual([entries[0]!]);
    expect(searchBlogIndex(entries, "CALIBRATION")).toEqual([entries[0]!]);
  });

  test("matches numeric and boolean-looking text as literal keywords", () => {
    const literal = entry("literal", "Version 2026", "Investigating false positives");
    expect(searchBlogIndex([literal], "2026")).toEqual([literal]);
    expect(searchBlogIndex([literal], "false")).toEqual([literal]);
    expect(searchBlogIndex([literal], "123456789")).toEqual([]);
  });

  test("requires all whitespace-separated terms across both fields", () => {
    expect(searchBlogIndex(entries, " practice\tcalibration ")).toEqual([entries[0]!]);
    expect(searchBlogIndex(entries, "practice missing")).toEqual([]);
  });

  test("treats punctuation and markup literally rather than as a regex", () => {
    const literal = entry("literal", "[a-z]+ <script>", "A+B & C");
    expect(searchBlogIndex([literal], "[a-z]+")).toEqual([literal]);
    expect(searchBlogIndex(entries, "[a-z]+")).toEqual([]);
    expect(searchBlogIndex([literal], "<script>")).toEqual([literal]);
  });

  test("returns a copy for an absent query and preserves sorted order", () => {
    expect(searchBlogIndex(entries, undefined)).toEqual(entries);
    expect(searchBlogIndex(entries, undefined)).not.toBe(entries);
    expect(searchBlogIndex(entries, "")).toEqual(entries);
    const sorted = sortBlogIndex(entries, "title-desc");
    expect(searchBlogIndex(sorted, "title")).toEqual([entries[1]!]);
    expect(entries.map((candidate) => candidate.slug)).toEqual(["measure", "other"]);
  });

  test("intersects with category without changing available categories", () => {
    const records = [
      entry("bench", "Practice benchmark"),
      entry("pack", "Practice pack", "", "packs"),
    ];
    expect(searchBlogIndex(filterBlogIndex(records, "benchmark"), "practice")).toEqual([
      records[0]!,
    ]);
    expect(searchBlogIndex(filterBlogIndex(records, "packs"), "benchmark")).toEqual([]);
    expect(records.length).toBe(2);
  });

  test("searches only the visible locale-merged index", () => {
    const records = [
      entry("measure", "English-only phrase"),
      { ...entry("measure", "中文标题", "本地摘要"), locale: "zh" },
      {
        ...entry("draft", "Hidden phrase"),
        data: { ...entries[0]!.data, title: "Hidden phrase", draft: true },
      },
    ];
    const merged = buildBlogIndex(records, "zh", { isDevelopment: false });
    expect(searchBlogIndex(merged, "中文").length).toBe(1);
    expect(searchBlogIndex(merged, "English-only")).toEqual([]);
    expect(searchBlogIndex(merged, "Hidden")).toEqual([]);
  });
});
