import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { preloadBlogContent } from "@/features/blog/content/client";
import { BlogPostScreen } from "@/features/blog";
import { blogPostHead } from "@/features/blog/model/blog-head";
import { loadBlogPost } from "@/features/blog/server/load-blog-post";
import { i18n } from "@/shared/i18n/config";

export const Route = createFileRoute("/blog/$slug")({
  component: Page,
  loader: async ({ params }) => {
    const post = await postLoader({ data: { slug: params.slug, lang: i18n.defaultLanguage } });
    await preloadBlogContent(post.path);
    return post;
  },
  head: ({ loaderData }) => blogPostHead(i18n.defaultLanguage, loaderData),
});

const postLoader = createServerFn({ method: "GET" })
  .validator((params: { slug: string; lang?: string }) => params)
  .handler(async ({ data }) => {
    const post = loadBlogPost(data);
    if (!post) throw notFound();
    return post;
  });

function Page() {
  return <BlogPostScreen lang={i18n.defaultLanguage} post={Route.useLoaderData()} />;
}
