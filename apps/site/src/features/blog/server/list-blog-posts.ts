import { i18n } from "@/shared/i18n/config";
import { buildBlogIndex, type BlogPostRecord } from "../model/list-posts";
import { pickFrontmatter } from "./pick-frontmatter";
import { blogSource } from "./source";

/**
 * Builds the deterministic blog index for one locale from the full source
 * (both locales are indexed by the Fumadocs source; merging happens in the
 * pure model so it stays testable without a filesystem).
 */
export function listBlogPosts(lang: string) {
  const records: BlogPostRecord[] = blogSource.getPages().map((page) => ({
    slug: page.slugs.join("/"),
    locale: page.locale ?? i18n.defaultLanguage,
    data: pickFrontmatter(page.data),
  }));

  return buildBlogIndex(records, lang);
}
