import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stripSearchParams } from "@tanstack/react-router";
import type { BlogSort } from "./model/sort-posts";

const controls = readFileSync(
  new URL("./components/blog-index-controls.tsx", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL("./components/blog-search-dialog.tsx", import.meta.url),
  "utf8",
);
const screen = readFileSync(new URL("./blog-index-screen.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("./server/list-blog-posts.ts", import.meta.url), "utf8");
const routes = ["../../routes/blog/index.tsx", "../../routes/$lang/blog/index.tsx"].map((path) =>
  readFileSync(new URL(path, import.meta.url), "utf8"),
);

describe("blog index discovery wiring", () => {
  test("links categories to the committed URL while preserving existing sort and query", () => {
    expect(controls).toContain('aria-current={category === candidate ? "page" : undefined}');
    expect(controls).not.toContain('id="blog-sort"');
    expect(controls).toContain("search={{ category: undefined, sort, q }}");
    expect(controls).toContain("search={{ category: candidate, sort, q }}");
    expect(controls).toContain("category={category} sort={sort} q={q}");
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
    expect(screen).toMatch(/role="status"\s+aria-live="polite"/);
    expect(screen).toContain("t.blogNoSearchResults");
  });

  test("submits real searches with accessible labels and complete query state", () => {
    expect(dialog).toContain("action={blogIndexPath(lang)}");
    expect(dialog).toContain('form="blog-search-form"');
    expect(dialog).toContain('type="search"');
    expect(dialog).toContain('name="q"');
    expect(dialog).toContain("maxLength={200}");
    expect(dialog).toContain('type="hidden" name="category" value={category}');
    expect(dialog).toContain('type="hidden" name="sort" value={sort}');
    expect(dialog).toContain('type="submit"');
    expect(dialog).toContain("aria-label={t.blogSearch}");
    expect(dialog).toContain("useNavigate()");
    expect(dialog).not.toContain("Cmd");
  });

  test("restores controlled input from committed URL state after navigation", () => {
    expect(dialog).toContain('useState(q ?? "")');
    expect(dialog).toContain('setSearch(q ?? "")');
    expect(dialog).toContain("[category, sort, q]");
    expect(dialog).toContain("search={search}");
    expect(dialog).toContain("onSearchChange={setSearch}");
    expect(dialog).not.toContain("defaultValue=");
  });

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

  test("uses typed query navigation and a GET form within the search popup", () => {
    expect(dialog).toContain("event.preventDefault()");
    expect(dialog).toContain("search: { category, sort, q: parseBlogQuery(search) }");
    expect(dialog).toContain('method="get"');
    expect(dialog).toContain("action={blogIndexPath(lang)}");
    const searchForm = dialog.slice(dialog.indexOf("<form"), dialog.indexOf("</form>"));
    expect(searchForm).not.toContain("key={");
  });
});
