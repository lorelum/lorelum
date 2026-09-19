import type { BlogFrontmatter } from "../content/frontmatter";
import { i18n } from "@/shared/i18n/config";
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
  readonly data: BlogFrontmatter;
}

/**
 * Resolves every server-owned value needed to render a single blog post.
 * Routes keep transport, server-function registration, and HTTP error
 * semantics; this module only assembles Fumadocs source data.
 */
export function loadBlogPost({ slug, lang }: LoadBlogPostInput): BlogPostData | undefined {
  const page = blogSource.getPage([slug], lang);
  if (!page) return undefined;

  return {
    slug,
    path: page.path,
    locale: page.locale ?? i18n.defaultLanguage,
    data: pickFrontmatter(page.data),
  };
}
