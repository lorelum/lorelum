import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stripSearchParams } from "@tanstack/react-router";
import type { BlogSort } from "./model/sort-posts";

const controls = readFileSync(new URL("./components/blog-index-controls.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("./blog-index-screen.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("./server/list-blog-posts.ts", import.meta.url), "utf8");
const routes = ["../../routes/blog/index.tsx", "../../routes/$lang/blog/index.tsx"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("blog index discovery wiring", () => {
  test("matches the full URL for every filter link so default sort is not also current", () => {
    expect(controls).toMatch(/search=\{\{ category: candidate, sort, q \}\}\s+activeOptions=\{\{ exact: true, includeSearch: true \}\}/);
    expect(controls).toMatch(/search=\{\{ category, sort: candidate, q \}\}\s+activeOptions=\{\{ exact: true, includeSearch: true \}\}/);
  });

  test("validates and propagates q through both route loaders and screens", () => {
    for (const route of routes) {
      expect(route).toContain("q: parseBlogQuery(search.q)");
      expect(route).toContain("q: search.q");
      expect(route).toContain("q: deps.q");
      expect(route).toContain("listBlogIndex(data.lang, data.category, data.sort, data.q)");
      expect(route).toContain("q={q}");
      expect(route).toContain('middlewares: [stripSearchParams({ sort: "newest" })]');
    }
  });

  test("intersects search with category while retaining the full visible index", () => {
    expect(server).toContain("searchBlogIndex(filterBlogIndex(posts, category), q)");
    expect(server).toContain("category === undefined && q === undefined");
    expect(server).toContain("posts,");
    expect(screen).toContain('role="status" aria-live="polite"');
    expect(screen).toContain("t.blogNoSearchResults");
  });

  test("submits real searches with accessible labels and complete query state", () => {
    expect(controls).toContain('action={blogIndexPath(lang)}');
    expect(controls).toContain('htmlFor="blog-search"');
    expect(controls).toContain('type="search"');
    expect(controls).toContain('name="q"');
    expect(controls).toContain("maxLength={200}");
    expect(controls).toContain('type="hidden" name="category" value={category}');
    expect(controls).toContain('type="hidden" name="sort" value={sort}');
    expect(controls).toContain('type="submit"');
    expect(controls).toContain('aria-label={t.blogSearch}');
    expect(controls).toContain('useNavigate()');
    expect(controls).not.toContain("Cmd");
  });

  test("restores controlled input from committed URL state after navigation", () => {
    expect(controls).toContain('useState(q ?? "")');
    expect(controls).toContain('setSearchInput(q ?? "")');
    expect(controls).toContain("[category, sort, q]");
    expect(controls).toContain("value={searchInput}");
    expect(controls).toContain("setSearchInput(event.target.value)");
    expect(controls).not.toContain("defaultValue=");
  });

  test("removes the default sort from URLs without stripping active filters", () => {
    const middleware = stripSearchParams<{ sort?: BlogSort; category?: string; q?: string }>({ sort: "newest" });
    const search = { sort: "newest" as const, category: "benchmark", q: "Practice" };
    expect(middleware({ search, next: (current) => current })).toEqual({ category: "benchmark", q: "Practice" });
    expect(middleware({ search: { sort: "newest" }, next: (current) => current })).toEqual({});
    expect(middleware({ search: { ...search, sort: "oldest" }, next: (current) => current })).toEqual({ ...search, sort: "oldest" });
    expect(search.sort).toBe("newest");
  });

  test("uses typed query navigation for scripted submits and retains native GET fallback", () => {
    expect(controls).toContain("event.preventDefault()");
    expect(controls).toContain("search: { category, sort, q: parseBlogQuery(searchInput) }");
    expect(controls).toContain('method="get"');
    expect(controls).toContain('action={blogIndexPath(lang)}');
    const searchForm = controls.slice(controls.indexOf("<form"), controls.indexOf("</form>"));
    expect(searchForm).not.toContain("key={");
  });
});
