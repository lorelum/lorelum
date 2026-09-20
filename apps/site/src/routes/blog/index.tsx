import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogIndexScreen } from "@/features/blog";
import type { BlogCategory } from "@/features/blog/content/frontmatter";
import { blogIndexHead } from "@/features/blog/model/blog-head";
import { parseBlogCategory } from "@/features/blog/model/category-label";
import { listBlogPosts } from "@/features/blog/server/list-blog-posts";
import { i18n } from "@/shared/i18n/config";

export const Route = createFileRoute("/blog/")({
  component: Page,
  // The category entry is a real URL, so the param is validated here rather
  // than trusted: anything that is not a known category means "no filter".
  validateSearch: (search: Record<string, unknown>): { category?: BlogCategory } => ({
    category: parseBlogCategory(search.category),
  }),
  // The loader context exposes `deps`, not `search`; this is how the validated
  // param reaches the server-side loader.
  loaderDeps: ({ search }) => ({ category: search.category }),
  loader: async ({ deps }) =>
    indexLoader({ data: { lang: i18n.defaultLanguage, category: deps.category } }),
  head: () => blogIndexHead(i18n.defaultLanguage),
});

const indexLoader = createServerFn({ method: "GET" })
  .validator((params: { lang: string; category?: BlogCategory }) => params)
  .handler(async ({ data }) => listBlogPosts(data.lang, data.category));

function Page() {
  const { category } = Route.useSearch();
  return (
    <BlogIndexScreen
      lang={i18n.defaultLanguage}
      posts={Route.useLoaderData()}
      category={category}
    />
  );
}
