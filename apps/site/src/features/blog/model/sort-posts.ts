import type { BlogIndexEntry } from "./list-posts";

/**
 * The orderings the index offers, and the URL vocabulary for them.
 *
 * `newest` is what `buildBlogIndex` already produces (date descending, then slug),
 * so choosing it asks for no work — the other three are what the sort control adds.
 * The vocabulary is a closed set that appears in the URL, and an unknown value is
 * read as the default rather than as an error: a shared or hand-edited link should
 * land on a list, the same way an unknown category does.
 */
export const blogSorts = ["newest", "oldest", "title-asc", "title-desc"] as const;

export type BlogSort = (typeof blogSorts)[number];

export const defaultBlogSort: BlogSort = "newest";

export function parseBlogSort(value: unknown): BlogSort {
  return typeof value === "string" && (blogSorts as readonly string[]).includes(value)
    ? (value as BlogSort)
    : defaultBlogSort;
}

/**
 * Apply an ordering to an index that is already date-descending.
 *
 * Titles sort in the language they were written in, not in the page's language:
 * the index merges both locales, and comparing a Chinese title against an English
 * one with the page's collator would order them by accident.
 */
export function sortBlogIndex(
  entries: readonly BlogIndexEntry[],
  sort: BlogSort,
): BlogIndexEntry[] {
  const ordered = [...entries];

  switch (sort) {
    case "newest":
      return ordered;
    case "oldest":
      return ordered.reverse();
    case "title-asc":
    case "title-desc": {
      const direction = sort === "title-asc" ? 1 : -1;
      return ordered.sort(
        (a, b) =>
          direction * a.data.title.localeCompare(b.data.title, a.locale) ||
          a.slug.localeCompare(b.slug),
      );
    }
  }
}
