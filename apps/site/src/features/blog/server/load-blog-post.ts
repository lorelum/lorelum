import type { BlogFrontmatter } from "../content/frontmatter";
import { i18n } from "@/shared/i18n/config";
import { pickAlternateLocale } from "../model/alternate-locale";
import { isPostVisible } from "../model/post-visibility";
import { pickFrontmatter } from "./pick-frontmatter";
import { blogSource } from "./source";

export interface LoadBlogPostInput {
  readonly slug: string;
  readonly lang?: string;
}

export interface BlogPostData {
  readonly slug: string;
  readonly path: string;
  readonly locale: string;
  /** The other locale this post is published in, when a translation exists. */
  readonly alternateLocale?: string;
  readonly data: BlogFrontmatter;
}

/**
 * Resolves every server-owned value needed to render a single blog post.
 * Routes keep transport, server-function registration, and HTTP error
 * semantics; this module only assembles Fumadocs source data.
 *
 * `alternateLocale` is resolved here rather than in the screen because only the
 * server holds the source index, and the language entry must not offer a
 * translation that does not exist: Fumadocs rewrites the locale prefix
 * unconditionally, so an offered-but-absent translation is a 404.
 */
export function loadBlogPost({ slug, lang }: LoadBlogPostInput): BlogPostData | undefined {
  const page = blogSource.getPage([slug], lang);
  if (!page) return undefined;

  // A draft is readable only while developing: it is not published, so its URL
  // does not exist in a production build. Returning `undefined` here is what the
  // routes already turn into `notFound()`, so the reader gets the blog's own
  // 404 rather than an empty article.
  const data = pickFrontmatter(page.data);
  if (!isPostVisible({ draft: data.draft, isDevelopment: import.meta.env.DEV })) {
    return undefined;
  }

  const locale = page.locale ?? i18n.defaultLanguage;
  const alternateLocale = pickAlternateLocale(locale, i18n.languages, (candidate) => {
    const candidatePage = blogSource.getPage([slug], candidate);
    if (candidatePage === undefined) return false;
    // A translation that is still a draft cannot be offered: the entry would
    // link to a URL that answers 404, which is how the prerenderer's crawl
    // learned to fail a build (it followed exactly that link).
    return isPostVisible({
      draft: pickFrontmatter(candidatePage.data).draft,
      isDevelopment: import.meta.env.DEV,
    });
  });

  return {
    slug,
    path: page.path,
    locale,
    ...(alternateLocale === undefined ? {} : { alternateLocale }),
    data,
  };
}
