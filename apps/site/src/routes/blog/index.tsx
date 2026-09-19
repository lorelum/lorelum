import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogIndexScreen } from "@/features/blog";
import { blogIndexHead } from "@/features/blog/model/blog-head";
import { listBlogPosts } from "@/features/blog/server/list-blog-posts";
import { i18n } from "@/shared/i18n/config";

export const Route = createFileRoute("/blog/")({
  component: Page,
  loader: async () => indexLoader({ data: { lang: i18n.defaultLanguage } }),
  head: () => blogIndexHead(i18n.defaultLanguage),
});

const indexLoader = createServerFn({ method: "GET" })
  .validator((params: { lang: string }) => params)
  .handler(async ({ data }) => listBlogPosts(data.lang));

function Page() {
  return <BlogIndexScreen lang={i18n.defaultLanguage} posts={Route.useLoaderData()} />;
}
