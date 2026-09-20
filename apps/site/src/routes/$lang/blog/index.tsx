import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogIndexScreen } from "@/features/blog";
import type { BlogCategory } from "@/features/blog/content/frontmatter";
import { blogIndexHead } from "@/features/blog/model/blog-head";
import { parseBlogCategory } from "@/features/blog/model/category-label";
import { isSupportedBlogLocale } from "@/features/blog/model/locale";
import { listBlogPosts } from "@/features/blog/server/list-blog-posts";

export const Route = createFileRoute("/$lang/blog/")({
  component: Page,
  // The category entry is a real URL, so the param is validated here rather
  // than trusted: anything that is not a known category means "no filter".
  validateSearch: (search: Record<string, unknown>): { category?: BlogCategory } => ({
    category: parseBlogCategory(search.category),
  }),
  // The loader context exposes `deps`, not `search`; this is how the validated
  // param reaches the server-side loader.
  loaderDeps: ({ search }) => ({ category: search.category }),
  loader: async ({ params, deps }) => {
    if (!isSupportedBlogLocale(params.lang)) throw notFound();
    return indexLoader({ data: { lang: params.lang, category: deps.category } });
  },
  head: ({ params }) => blogIndexHead(params.lang),
});

const indexLoader = createServerFn({ method: "GET" })
  .validator((params: { lang: string; category?: BlogCategory }) => params)
  .handler(async ({ data }) => listBlogPosts(data.lang, data.category));

function Page() {
  const { lang } = Route.useParams();
  const { category } = Route.useSearch();
  return <BlogIndexScreen lang={lang} posts={Route.useLoaderData()} category={category} />;
}
