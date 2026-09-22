import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogNotFound, BlogPostScreen } from "@/features/blog";
import { preloadBlogContent } from "@/features/blog/content/client";
import { adjacentPosts } from "@/features/blog/model/adjacent-posts";
import { blogPostHead } from "@/features/blog/model/blog-head";
import { loadBlogPost } from "@/features/blog/server/load-blog-post";
import { listBlogPosts } from "@/features/blog/server/list-blog-posts";
import { i18n } from "@/shared/i18n/config";

export const Route = createFileRoute("/blog/$slug")({
  component: Page,
  notFoundComponent: () => <BlogNotFound lang={i18n.defaultLanguage} />,
  loader: async ({ params }) => {
    const page = await pageLoader({ data: { slug: params.slug, lang: i18n.defaultLanguage } });
    await preloadBlogContent(page.post.path);
    return page;
  },
  head: ({ loaderData }) => blogPostHead(i18n.defaultLanguage, loaderData?.post),
});

const pageLoader = createServerFn({ method: "GET" })
  .validator((params: { slug: string; lang?: string }) => params)
  .handler(async ({ data }) => {
    const post = loadBlogPost(data);
    if (!post) throw notFound();

    // The neighbours and the shell's left column come from the post's own locale
    // index — built once here, so the screen never sees the source and the
    // sidebar lists exactly what the index lists.
    const posts = listBlogPosts(post.locale);
    const adjacent = adjacentPosts(posts, post.slug);

    return { post, adjacent, posts };
  });

function Page() {
  const { post, adjacent, posts } = Route.useLoaderData();
  return (
    <BlogPostScreen
      lang={i18n.defaultLanguage}
      post={post}
      adjacent={adjacent}
      posts={posts}
    />
  );
}
