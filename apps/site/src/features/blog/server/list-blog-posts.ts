import { i18n } from "@/shared/i18n/config";
import type { BlogCategory } from "../content/frontmatter";
import { buildBlogIndex, filterBlogIndex, type BlogPostRecord } from "../model/list-posts";
import { pickFrontmatter } from "./pick-frontmatter";
import { blogSource } from "./source";

/**
 * Builds the deterministic blog index for one locale from the full source
 * (both locales are indexed by the Fumadocs source; merging happens in the
 * pure model so it stays testable without a filesystem).
 *
 * The category filter is applied here, on the server, rather than in the
 * component: a category entry is a real, shareable URL, so the response the
 * reader receives — including one with no JavaScript — must already be the
 * filtered list.
 */
export function listBlogPosts(lang: string, category?: BlogCategory) {
  const records: BlogPostRecord[] = blogSource.getPages().map((page) => ({
    slug: page.slugs.join("/"),
    locale: page.locale ?? i18n.defaultLanguage,
    data: pickFrontmatter(page.data),
  }));

  return filterBlogIndex(buildBlogIndex(records, lang), category);
}
