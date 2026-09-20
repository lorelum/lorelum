import type { BlogFrontmatter } from "../content/frontmatter";
import { i18n } from "@/shared/i18n/config";
import { pickAlternateLocale } from "../model/alternate-locale";
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

  const locale = page.locale ?? i18n.defaultLanguage;
  const alternateLocale = pickAlternateLocale(
    locale,
    i18n.languages,
    (candidate) => blogSource.getPage([slug], candidate) !== undefined,
  );

  return {
    slug,
    path: page.path,
    locale,
    ...(alternateLocale === undefined ? {} : { alternateLocale }),
    data: pickFrontmatter(page.data),
  };
}
