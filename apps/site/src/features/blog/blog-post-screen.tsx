import { Suspense, use } from "react";
import { DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { TOCProvider, TOCScrollArea, useTOCItems } from "fumadocs-ui/components/toc";
import { TOCItem, TOCItems } from "fumadocs-ui/components/toc/default";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { AdjacentPosts } from "./model/adjacent-posts";
import { readingTocItems } from "./model/toc-items";
import { BlogClosing } from "./components/blog-closing";
import { BlogPostMeta } from "./components/blog-post-meta";
import { BlogSurface } from "./components/blog-surface";
import { loadBlogContent } from "./content/client";
import { useBlogMdxComponents } from "./mdx/blog-mdx-components";
import type { BlogPostData } from "./server/load-blog-post";
import "./styles/blog.css";

interface BlogPostScreenProps {
  readonly lang: string;
  readonly post: BlogPostData;
  /** Neighbours in the post's own locale, resolved by the route's loader. */
  readonly adjacent: AdjacentPosts;
}

/** The list itself, shared by the desktop rail and the narrow-viewport disclosure. */
function BlogTocList() {
  const items = readingTocItems(useTOCItems());

  return (
    <TOCScrollArea>
      {/* `thumbBox={false}` drops the thumb indicator dot — that prop is what
          the dot is gated on. It does *not* remove the track: `TOCItems`
          renders `ThumbTrack` whenever its measurement produced an SVG, and
          that component ignores `thumbBox` except for the dot. Measured in the
          built rail: 0 dot elements, 1 track svg.
          The reason is preference, not correctness. The drafts claimed the
          thumb was measured in `useLayoutEffect` and would misalign inside a
          closed `<details>`, but the installed version measures in `useEffect`
          and returns early when `container.clientHeight === 0`, so a closed
          disclosure never renders one. A short list whose active entry is
          already marked with colour and weight does not need the dot. */}
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
      className="blog-toc sticky top-[var(--blog-sticky-offset)] hidden max-h-[calc(100dvh-var(--blog-sticky-offset)-1rem)] w-[var(--blog-toc-rail)] shrink-0 overflow-y-auto pb-8 pe-2 pt-2 xl:block"
    >
      <p className="text-sm text-fd-muted-foreground">{t.blogOnThisPage}</p>
      <BlogTocList />
    </aside>
  );
}

/**
 * Narrow viewports get the same list inside a native disclosure, placed right
 * after the metadata line.
 *
 * This makes the table of contents *reachable* without JavaScript, which is all
 * a `<details>` can promise: once the reader opens it and scrolls, it closes
 * behind them. A persistent narrow-viewport navigator would be a separate
 * feature (a sticky bar or a progress indicator) and is not attempted here.
 */
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

function BlogPostBody({ lang, post, adjacent }: BlogPostScreenProps) {
  const { default: MDX, toc } = use(loadBlogContent(post.path));
  const { data } = post;

  return (
    // The provider observes heading anchors across the reading row, so it wraps
    // both the article and the table of contents.
    <TOCProvider toc={toc}>
      <div className="mx-auto flex w-full items-start justify-center gap-6 xl:gap-10">
        <article className="blog-post__body w-full min-w-0 max-w-[var(--lore-reading-width)]">
          <DocsTitle>{data.title}</DocsTitle>
          <DocsDescription>{data.description}</DocsDescription>

          <BlogPostMeta
            slug={post.slug}
            locale={post.locale}
            alternateLocale={post.alternateLocale}
            data={data}
          />

          <BlogTocDisclosure lang={lang} />

          {/* `.blog-post__reading` is the prose scope hook. The disclosure above
              renders Fumadocs TOC entries, which carry the `prose` class
              themselves, so scoping the body rules to `article` would restyle
              them as body text. This wrapper is the narrowest ancestor that
              holds the prose content and nothing else. */}
          <div className="blog-post__reading">
            <DocsBody>
              <MDX components={useBlogMdxComponents()} />
            </DocsBody>
          </div>

          <BlogClosing locale={post.locale} adjacent={adjacent} />
        </article>

        <BlogTocRail lang={lang} />
      </div>
    </TOCProvider>
  );
}

/**
 * Browser screen for a single blog post: the site navbar plus a reading column
 * with a table of contents. The Fumadocs page atoms (title, description, prose
 * body, TOC) render inside the `.blog-scope` token adapter; the navbar and
 * footer intentionally keep the global landing theme.
 *
 * The body is wrapped in `Suspense` because the MDX module is loaded on the
 * client: the fallback is a static placeholder of the reading column's own
 * width, so resolving it does not shift the column.
 */
export function BlogPostScreen({ lang, post, adjacent }: BlogPostScreenProps) {
  return (
    <BlogSurface lang={lang} mainClassName="blog-post__frame">
      <Suspense
        fallback={
          <div
            aria-busy="true"
            className="mx-auto min-h-[32rem] w-full max-w-[var(--lore-reading-width)]"
          />
        }
      >
        <BlogPostBody lang={lang} post={post} adjacent={adjacent} />
      </Suspense>
    </BlogSurface>
  );
}
