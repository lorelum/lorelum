import { describe, expect, test } from "bun:test";
import { stripSearchParams } from "@tanstack/react-router";
import type { BlogSort } from "./model/sort-posts";

describe("blog index URL normalization", () => {
  const middleware = stripSearchParams<{
    sort?: BlogSort;
    category?: string;
    q?: string;
    page?: number;
  }>({ sort: "newest", page: 1 });

  test("removes default sort and page without stripping active filters", () => {
    const search = { sort: "newest" as const, page: 1, category: "benchmark", q: "Practice" };
    expect(middleware({ search, next: (current) => current })).toEqual({
      category: "benchmark",
      q: "Practice",
    });
    expect(middleware({ search: { sort: "newest", page: 1 }, next: (current) => current })).toEqual(
      {},
    );
    expect(search).toEqual({
      sort: "newest",
      page: 1,
      category: "benchmark",
      q: "Practice",
    });
  });

  test("keeps non-default pages and combined discovery parameters", () => {
    const search = { sort: "oldest" as const, page: 2, category: "benchmark", q: "Practice" };
    expect(middleware({ search, next: (current) => current })).toEqual(search);
    expect(
      middleware({ search: { ...search, sort: "newest" }, next: (current) => current }),
    ).toEqual({ page: 2, category: "benchmark", q: "Practice" });
    expect(middleware({ search: { ...search, page: 1 }, next: (current) => current })).toEqual({
      sort: "oldest",
      category: "benchmark",
      q: "Practice",
    });
  });
});
