import type { BlogFrontmatter } from "../content/frontmatter";

/** One locale's version of a post, as read from the source index. */
export interface BlogPostRecord {
  readonly slug: string;
  readonly locale: string;
  readonly data: BlogFrontmatter;
}

/** One merged index entry for a locale's list page. */
export interface BlogIndexEntry {
  readonly slug: string;
  readonly locale: string;
  /**
   * `false` when the entry is only available in the other language; the index
   * still lists it (linked to the existing language) with a visible marker.
   */
  readonly translated: boolean;
  readonly data: BlogFrontmatter;
}

/**
 * Merge both locales' records into one deterministic index:
 *
 * - drafts never appear;
 * - the requested locale's file wins when both exist; a slug that only exists
 *   in the other locale is still listed with `translated: false`;
 * - entries sort by date descending, then slug ascending.
 */
export function buildBlogIndex(records: readonly BlogPostRecord[], lang: string): BlogIndexEntry[] {
  const bySlug = new Map<string, BlogIndexEntry>();

  const localeRank = (locale: string) => (locale === lang ? 0 : 1);
  const ordered = [...records].sort(
    (a, b) => localeRank(a.locale) - localeRank(b.locale) || a.slug.localeCompare(b.slug),
  );

  for (const record of ordered) {
    if (record.data.draft) continue;
    if (bySlug.has(record.slug)) continue;

    bySlug.set(record.slug, {
      slug: record.slug,
      locale: record.locale,
      translated: record.locale !== lang,
      data: record.data,
    });
  }

  return [...bySlug.values()].sort(
    (a, b) => b.data.date.localeCompare(a.data.date) || a.slug.localeCompare(b.slug),
  );
}
