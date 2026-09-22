import { isPostVisible } from "./post-visibility";
import type { BlogCategory, BlogFrontmatter } from "../content/frontmatter";

/** One locale's version of a post, as read from the source index. */
export interface BlogPostRecord {
  readonly slug: string;
  readonly locale: string;
  readonly data: BlogFrontmatter;
}

/** One merged index entry for a locale's list page. */
export interface BlogIndexEntry {
  readonly slug: string;
  /**
   * The language this entry's file exists in. It is not always the list page's
   * language: the index merges both locales, so an entry can be the other
   * language's version, and the row builds its link from this field
   * (`blogPostPath(entry.locale, entry.slug)`) and its language hint from
   * `languageHintKey(entry.locale, lang)`.
   */
  readonly locale: string;
  readonly data: BlogFrontmatter;
}

/** The environment the index is being built for. */
export interface BlogIndexOptions {
  /**
   * Required rather than defaulted: the index and the article's own URL must
   * answer the same question about a draft, and a default would let a caller
   * answer it silently. In development the index lists drafts — so the author
   * can reach the page they are writing — and everywhere else it does not.
   */
  readonly isDevelopment: boolean;
}

/**
 * Merge both locales' records into one deterministic index:
 *
 * - a post is listed exactly when `isPostVisible` says its own URL is served, so
 *   the index and the article URL agree in every environment;
 * - the requested locale's file wins when both exist; a slug that only exists
 *   in the other locale is still listed, carrying that language in `locale` so the
 *   row links to the file that exists;
 * - entries sort by date descending, then slug ascending.
 */
export function buildBlogIndex(
  records: readonly BlogPostRecord[],
  lang: string,
  { isDevelopment }: BlogIndexOptions,
): BlogIndexEntry[] {
  const bySlug = new Map<string, BlogIndexEntry>();

  const localeRank = (locale: string) => (locale === lang ? 0 : 1);
  const ordered = [...records].sort(
    (a, b) => localeRank(a.locale) - localeRank(b.locale) || a.slug.localeCompare(b.slug),
  );

  for (const record of ordered) {
    if (!isPostVisible({ draft: record.data.draft, isDevelopment })) continue;
    if (bySlug.has(record.slug)) continue;

    bySlug.set(record.slug, {
      slug: record.slug,
      locale: record.locale,
      data: record.data,
    });
  }

  return [...bySlug.values()].sort(
    (a, b) => b.data.date.localeCompare(a.data.date) || a.slug.localeCompare(b.slug),
  );
}

/**
 * Keep only the entries in one category. `undefined` means no filter, and the
 * input is never mutated — the unfiltered index is the route's loader data and
 * callers may hold it across renders.
 */
export function filterBlogIndex(
  entries: readonly BlogIndexEntry[],
  category: BlogCategory | undefined,
): BlogIndexEntry[] {
  if (category === undefined) return [...entries];
  return entries.filter((entry) => entry.data.category === category);
}
