import { Suspense, use, useState } from "react";
import { DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { TOCProvider, TOCScrollArea, useTOCItems } from "fumadocs-ui/components/toc";
import { TOCItem, TOCItems } from "fumadocs-ui/components/toc/default";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { AdjacentPosts } from "./model/adjacent-posts";
import { articleLanguageTarget } from "./model/language-target";
import { readingTocItems } from "./model/toc-items";
import { BlogClosing } from "./components/blog-closing";
import { BlogPostMeta } from "./components/blog-post-meta";
import { BlogShell } from "./components/blog-shell";
import { BlogSidebar } from "./components/blog-sidebar";
import { BlogSurface } from "./components/blog-surface";
import { loadBlogContent } from "./content/client";
import { useBlogMdxComponents } from "./mdx/blog-mdx-components";
import type { BlogIndexEntry } from "./model/list-posts";
import type { BlogPostData } from "./server/load-blog-post";
import "./styles/blog.css";

interface BlogPostScreenProps {
  readonly lang: string;
  readonly post: BlogPostData;
  /** Neighbours in the post's own locale, resolved by the route's loader. */
  readonly adjacent: AdjacentPosts;
  /** The same locale's index, already built for the neighbours. The shell's left column renders it. */
  readonly posts: readonly BlogIndexEntry[];
}

/** The list itself, shared by the desktop rail and the narrow-viewport disclosure. */
function BlogTocList() {
  const items = readingTocItems(useTOCItems());

  return (
    <TOCScrollArea>
      {/* Hide the optional active-item dot; Fumadocs still renders its track. */}
      <TOCItems thumbBox={false}>
        {items.map((item) => (
          <TOCItem key={item.url} item={item} />
        ))}
      </TOCItems>
    </TOCScrollArea>
  );
}

/** Sticky right-rail table of contents, from `xl` up. */
function BlogTocRail({ lang }: { lang: string }) {
  const t = getStrings(lang);

  return (
    <aside
      aria-label={t.blogOnThisPage}
      className="blog-toc sticky top-[var(--blog-sticky-offset)] max-h-[calc(100dvh-var(--blog-sticky-offset)-1rem)] w-[var(--blog-toc-rail)] shrink-0 overflow-y-auto pb-8 pe-2 pt-2"
    >
      <p className="text-sm text-fd-muted-foreground">{t.blogOnThisPage}</p>
      <BlogTocList />
    </aside>
  );
}

/** Native table-of-contents disclosure below the masthead on narrow viewports. */
function BlogTocDisclosure({ lang }: { lang: string }) {
  const t = getStrings(lang);

  return (
    <details className="blog-toc-disclosure mt-6 xl:hidden">
      <summary className="cursor-pointer text-sm text-fd-muted-foreground">
        {t.blogOnThisPage}
      </summary>
      <nav aria-label={t.blogOnThisPage} className="mt-2">
        <BlogTocList />
      </nav>
    </details>
  );
}

function BlogPostBody({
  lang,
  post,
  adjacent,
  posts,
  onMasthead,
}: BlogPostScreenProps & {
  /** Callback ref keeps the navbar in sync when the suspended masthead mounts. */
  readonly onMasthead: (element: HTMLElement | null) => void;
}) {
  const { default: MDX, toc } = use(loadBlogContent(post.path));
  const { data } = post;

  return (
    // The provider observes headings in the article and drives both TOC lists.
    <TOCProvider toc={toc}>
      <BlogShell
        sidebar={<BlogSidebar lang={lang} posts={posts} />}
        rail={<BlogTocRail lang={lang} />}
      >
        <article className="blog-post__body mx-auto w-full min-w-0 max-w-[var(--blog-measure)]">
          {/* The navbar collapses after the reader scrolls past the masthead. */}
          <div ref={onMasthead}>
            <DocsTitle className="text-4xl leading-tight sm:text-5xl">{data.title}</DocsTitle>
            <DocsDescription className="mt-5 leading-relaxed">{data.description}</DocsDescription>

            <BlogPostMeta locale={post.locale} data={data} />

            {data.image === undefined ? null : (
              <img
                src={data.image}
                alt=""
                decoding="async"
                className="mt-8 block aspect-[16/9] w-full rounded-[var(--lore-radius-panel)] object-cover sm:aspect-[3/2]"
              />
            )}
          </div>

          <BlogTocDisclosure lang={lang} />

          {/* Scope prose rules separately: Fumadocs TOC items also carry `prose`. */}
          <div className="blog-post__reading mt-8 sm:mt-12">
            <DocsBody>
              <MDX components={useBlogMdxComponents()} />
            </DocsBody>
          </div>

          <BlogClosing locale={post.locale} adjacent={adjacent} />
        </article>
      </BlogShell>
    </TOCProvider>
  );
}

/** Load the article MDX inside the blog shell without shifting the reading column. */
export function BlogPostScreen({ lang, post, adjacent, posts }: BlogPostScreenProps) {
  // State updates the navbar when the suspended masthead mounts; a ref would not.
  const [masthead, setMasthead] = useState<HTMLElement | null>(null);

  return (
    <BlogSurface
      lang={lang}
      collapseTrigger={masthead}
      // Use a published translation, or its locale's index, rather than a blind prefix swap.
      languageHref={articleLanguageTarget({
        lang,
        slug: post.slug,
        alternateLocale: post.alternateLocale,
      })}
    >
      <Suspense
        fallback={
          <div
            aria-busy="true"
            className="mx-auto min-h-[32rem] w-full max-w-[var(--blog-measure)]"
          />
        }
      >
        <BlogPostBody
          lang={lang}
          post={post}
          adjacent={adjacent}
          posts={posts}
          onMasthead={setMasthead}
        />
      </Suspense>
    </BlogSurface>
  );
}
