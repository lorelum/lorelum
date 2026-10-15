import { createFileRoute, notFound, stripSearchParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogIndexScreen } from "@/features/blog";
import type { BlogCategory } from "@/features/blog/content/frontmatter";
import { blogIndexHead } from "@/features/blog/model/blog-head";
import { parseBlogCategory } from "@/features/blog/model/category-label";
import { parseBlogPage } from "@/features/blog/model/index-layout";
import { parseBlogSort, type BlogSort } from "@/features/blog/model/sort-posts";
import { parseBlogQuery } from "@/features/blog/model/search-posts";
import { isSupportedBlogLocale } from "@/features/blog/model/locale";
import { listBlogIndex } from "@/features/blog/server/list-blog-posts";

export const Route = createFileRoute("/$lang/blog/")({
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
  loader: async ({ params, deps }) => {
    if (!isSupportedBlogLocale(params.lang)) throw notFound();
    return indexLoader({
      data: { lang: params.lang, category: deps.category, sort: deps.sort, q: deps.q },
    });
  },
  head: ({ params }) => blogIndexHead(params.lang),
});

const indexLoader = createServerFn({ method: "GET" })
  .validator(
    (params: { lang: string; category?: BlogCategory; sort?: BlogSort; q?: string }) => params,
  )
  .handler(async ({ data }) => listBlogIndex(data.lang, data.category, data.sort, data.q));

function Page() {
  const { lang } = Route.useParams();
  const { category, sort, q, page } = Route.useSearch();
  const { posts, filteredPostSlugs } = Route.useLoaderData();
  return (
    <BlogIndexScreen
      lang={lang}
      posts={posts}
      filteredPostSlugs={filteredPostSlugs}
      category={category}
      sort={sort}
      q={q}
      page={page}
    />
  );
}
