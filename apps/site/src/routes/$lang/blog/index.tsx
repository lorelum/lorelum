import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogIndexScreen } from "@/features/blog";
import { blogIndexHead } from "@/features/blog/model/blog-head";
import { isSupportedBlogLocale } from "@/features/blog/model/locale";
import { listBlogPosts } from "@/features/blog/server/list-blog-posts";

export const Route = createFileRoute("/$lang/blog/")({
  component: Page,
  loader: async ({ params }) => {
    if (!isSupportedBlogLocale(params.lang)) throw notFound();
    return indexLoader({ data: { lang: params.lang } });
  },
  head: ({ params }) => blogIndexHead(params.lang),
});

const indexLoader = createServerFn({ method: "GET" })
  .validator((params: { lang: string }) => params)
  .handler(async ({ data }) => listBlogPosts(data.lang));

function Page() {
  const { lang } = Route.useParams();
  return <BlogIndexScreen lang={lang} posts={Route.useLoaderData()} />;
}
