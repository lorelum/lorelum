import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { preloadBlogContent } from "@/features/blog/content/client";
import { BlogPostScreen } from "@/features/blog";
import { blogPostHead } from "@/features/blog/model/blog-head";
import { isSupportedBlogLocale } from "@/features/blog/model/locale";
import { loadBlogPost } from "@/features/blog/server/load-blog-post";

export const Route = createFileRoute("/$lang/blog/$slug")({
  component: Page,
  loader: async ({ params }) => {
    if (!isSupportedBlogLocale(params.lang)) throw notFound();

    const post = await postLoader({ data: { slug: params.slug, lang: params.lang } });
    await preloadBlogContent(post.path);
    return post;
  },
  head: ({ params, loaderData }) => blogPostHead(params.lang, loaderData),
});

const postLoader = createServerFn({ method: "GET" })
  .validator((params: { slug: string; lang?: string }) => params)
  .handler(async ({ data }) => {
    const post = loadBlogPost(data);
    if (!post) throw notFound();
    return post;
  });

function Page() {
  const { lang } = Route.useParams();
  return <BlogPostScreen lang={lang} post={Route.useLoaderData()} />;
}
