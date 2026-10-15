import { describe, expect, test } from "bun:test";
import { stripSearchParams } from "@tanstack/react-router";
import type { BlogSort } from "./model/sort-posts";

describe("blog index URL normalization", () => {
  test("removes the default sort from URLs without stripping active filters", () => {
    const middleware = stripSearchParams<{ sort?: BlogSort; category?: string; q?: string }>({
      sort: "newest",
    });
    const search = { sort: "newest" as const, category: "benchmark", q: "Practice" };
    expect(middleware({ search, next: (current) => current })).toEqual({
      category: "benchmark",
      q: "Practice",
    });
    expect(middleware({ search: { sort: "newest" }, next: (current) => current })).toEqual({});
    expect(
      middleware({ search: { ...search, sort: "oldest" }, next: (current) => current }),
    ).toEqual({ ...search, sort: "oldest" });
    expect(search.sort).toBe("newest");
  });
});
