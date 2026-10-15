import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  stripSearchParams,
} from "@tanstack/react-router";
import { parseBlogPage } from "../model/index-layout";
import { parseBlogCategory } from "../model/category-label";
import { parseBlogSort } from "../model/sort-posts";
import { parseBlogQuery } from "../model/search-posts";
import { BlogIndexPagination } from "./blog-index-pagination";

async function renderPages(url: string, pageCount = 3) {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: "/blog",
    validateSearch: (search: Record<string, unknown>) => ({
      page: parseBlogPage(search.page),
      category: parseBlogCategory(search.category),
      sort: parseBlogSort(search.sort),
      q: parseBlogQuery(search.q),
    }),
    search: { middlewares: [stripSearchParams({ page: 1, sort: "newest" })] },
    component: function Pages() {
      const { page, category, sort, q } = route.useSearch();
      return (
        <BlogIndexPagination
          lang="en"
          page={Math.min(page, pageCount)}
          pageCount={pageCount}
          category={category}
          sort={sort}
          q={q}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  const html = renderToStaticMarkup(<RouterProvider router={router} />);
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    current: match[1]?.includes('aria-current="page"') ?? false,
    text: match[2]?.replace(/<[^>]+>/g, "") ?? "",
    href: /href="([^"]*)"/.exec(match[1] ?? "")?.[1]?.replaceAll("&amp;", "&") ?? "",
  }));
}

describe("blog pagination links", () => {
  test("marks only page two, not its first-page or Previous links", async () => {
    const links = await renderPages("/blog?page=2");
    expect(links.filter((link) => link.current).map((link) => link.text)).toEqual(["2"]);
  });

  test("keeps filters on every destination and omits the default page", async () => {
    const links = await renderPages("/blog?category=benchmark&sort=oldest&q=Practice&page=2");
    const urls = links.map((link) => new URL(link.href, "https://example.com"));
    for (const url of urls) {
      expect(url.pathname).toBe("/blog");
      expect(url.searchParams.get("category")).toBe("benchmark");
      expect(url.searchParams.get("sort")).toBe("oldest");
      expect(url.searchParams.get("q")).toBe("Practice");
    }
    expect([...new Set(urls.map((url) => url.searchParams.get("page")))].sort()).toEqual([
      "2",
      "3",
      null,
    ]);
  });

  test("marks the normalized last page for an out-of-range URL", async () => {
    const links = await renderPages("/blog?page=999");
    expect(links.filter((link) => link.current).map((link) => link.text)).toEqual(["3"]);
    expect(
      [
        ...new Set(
          links.map((link) => new URL(link.href, "https://example.com").searchParams.get("page")),
        ),
      ].sort(),
    ).toEqual(["2", "3", null]);
  });

  test("does not offer navigation when all results fit on one page", async () => {
    expect(await renderPages("/blog", 1)).toEqual([]);
  });
});
