import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogIndexScreen } from "@/features/blog";
import type { BlogCategory } from "@/features/blog/content/frontmatter";
import { blogIndexHead } from "@/features/blog/model/blog-head";
import { parseBlogCategory } from "@/features/blog/model/category-label";
import { parseBlogPage } from "@/features/blog/model/index-layout";
import { parseBlogSort, type BlogSort } from "@/features/blog/model/sort-posts";
import { parseBlogQuery } from "@/features/blog/model/search-posts";
import { listBlogIndex } from "@/features/blog/server/list-blog-posts";
import { i18n } from "@/shared/i18n/config";

export const Route = createFileRoute("/blog/")({
  component: Page,
  search: { middlewares: [stripSearchParams({ sort: "newest", page: 1 })] },
  // The category entry is a real URL, so the param is validated here rather
  // than trusted: anything that is not a known category means "no filter".
  validateSearch: (
    search: Record<string, unknown>,
  ): { category?: BlogCategory; sort: BlogSort; q?: string; page: number } => ({
    category: parseBlogCategory(search.category),
    sort: parseBlogSort(search.sort),
    q: parseBlogQuery(search.q),
    page: parseBlogPage(search.page),
  }),
  // The loader context exposes `deps`, not `search`; this is how the validated
  // param reaches the server-side loader.
  loaderDeps: ({ search }) => ({ category: search.category, sort: search.sort, q: search.q }),
  loader: async ({ deps }) =>
    indexLoader({
      data: { lang: i18n.defaultLanguage, category: deps.category, sort: deps.sort, q: deps.q },
    }),
  head: () => blogIndexHead(i18n.defaultLanguage),
});

const indexLoader = createServerFn({ method: "GET" })
  .validator(
    (params: { lang: string; category?: BlogCategory; sort?: BlogSort; q?: string }) => params,
  )
  .handler(async ({ data }) => listBlogIndex(data.lang, data.category, data.sort, data.q));

function Page() {
  const { category, sort, q, page } = Route.useSearch();
  const { posts, filteredPostSlugs } = Route.useLoaderData();
  return (
    <BlogIndexScreen
      lang={i18n.defaultLanguage}
      posts={posts}
      filteredPostSlugs={filteredPostSlugs}
      category={category}
      sort={sort}
      q={q}
      page={page}
    />
  );
}
