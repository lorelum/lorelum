import { describe, expect, test } from "bun:test";
import { blogDialogResults } from "./dialog-results";
import type { BlogIndexEntry } from "./list-posts";

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

describe("blog dialog results", () => {
  test("does not match posts before a nonblank draft is entered", () => {
    const posts = [entry("first", "First"), entry("second", "Second")];
    for (const query of ["", "  ", "\t\n", "\u3000"]) {
      expect(blogDialogResults(posts, query, undefined, "newest")).toEqual([]);
      expect(blogDialogResults(posts, query, "benchmark", "title-asc")).toEqual([]);
    }
  });

  test("clearing a matching draft returns to the idle state", () => {
    const posts = [entry("first", "First")];
    expect(blogDialogResults(posts, "First", undefined, "newest")).toEqual(posts);
    expect(blogDialogResults(posts, "", undefined, "newest")).toEqual([]);
  });

  test("intersects current category and literal title/summary search", () => {
    const posts = [
      entry("one", "Practice", "measured"),
      entry("two", "Practice", "measured", "packs"),
      entry("three", "Other"),
    ];
    expect(
      blogDialogResults(posts, "Practice measured", "benchmark", "newest").map((post) => post.slug),
    ).toEqual(["one"]);
  });

  test("uses NFKC and case normalization without searching author", () => {
    const posts = [entry("one", "Practice 注入", "measurement")];
    expect(blogDialogResults(posts, "ＰＲＡＣＴＩＣＥ measurement", undefined, "newest")).toEqual(
      posts,
    );
    expect(blogDialogResults(posts, "Only in author", undefined, "newest")).toEqual([]);
  });

  test("uses the current ordering and does not mutate source entries", () => {
    const posts = [entry("zulu", "Zulu", "shared"), entry("alpha", "Alpha", "shared")];
    const before = [...posts];
    expect(
      blogDialogResults(posts, "shared", undefined, "title-asc").map((post) => post.slug),
    ).toEqual(["alpha", "zulu"]);
    expect(
      blogDialogResults(posts, "shared", undefined, "title-desc").map((post) => post.slug),
    ).toEqual(["zulu", "alpha"]);
    expect(blogDialogResults(posts, "shared", undefined, "oldest")).toEqual([...posts].reverse());
    expect(posts).toEqual(before);
  });

  test("preserves an entry's own locale for result navigation", () => {
    const post = { ...entry("one", "中文"), locale: "zh" };
    expect(blogDialogResults([post], "中文", undefined, "newest")[0]?.locale).toBe("zh");
  });

  test("shares the 200-character query bound and real empty-result behavior", () => {
    const posts = [entry("one", "x".repeat(200))];
    expect(blogDialogResults(posts, "x".repeat(201), undefined, "newest")).toEqual(posts);
    expect(blogDialogResults(posts, "no such title", undefined, "newest")).toEqual([]);
  });
});
