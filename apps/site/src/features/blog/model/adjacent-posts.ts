import type { BlogIndexEntry } from "./list-posts";

export interface AdjacentPosts {
  /** The next-older post in the same locale, if any. */
  readonly previous?: BlogIndexEntry;
  /** The next-newer post in the same locale, if any. */
  readonly next?: BlogIndexEntry;
}

/**
 * The post's neighbours in the locale's own index, which is ordered by date
 * descending. "Previous" therefore means older and "next" newer, so the pair
 * reads the same way the index does.
 *
 * Only same-locale entries are considered: a reader following the pair stays in
 * the language they are reading, and an entry that only exists in the other
 * language would otherwise send them across locales without saying so.
 */
export function adjacentPosts(
  entries: readonly BlogIndexEntry[],
  slug: string,
): AdjacentPosts {
  const index = entries.findIndex((entry) => entry.slug === slug);
  if (index === -1) return {};

  const older = index + 1 < entries.length ? entries[index + 1] : undefined;
  const newer = index > 0 ? entries[index - 1] : undefined;

  return { previous: older, next: newer };
}
