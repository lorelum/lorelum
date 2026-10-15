/**
 * Table-of-contents shape the article rail consumes.
 *
 * Structural on purpose: the caller passes Fumadocs' `TOCItemType[]`, and this
 * module never imports the library, so the filter stays testable without the
 * framework and the article keeps the library's own item type.
 */
export interface TocItemLike {
  readonly depth: number;
  readonly url: string;
}

/**
 * The depth the rail tracks. `rehypeToc` collects h1–h6, so a document that
 * grows an h4 would otherwise flood a rail sized for the reading structure.
 *
 * The plan called for Fumadocs' `selectTocItems(items, 3)`. That helper does
 * not exist in the installed version (fumadocs-ui is an alias for
 * `@fumadocs/base-ui@16.14.4`, whose TOC exports are `TOCProvider`,
 * `TOCScrollArea`, `useTOCItems` and the item components — no selector), so the
 * filter is local and tested here instead.
 */
export const readingTocDepth = 3;

export function readingTocItems<T extends TocItemLike>(
  items: readonly T[],
  maxDepth: number = readingTocDepth,
): T[] {
  return items.filter((item) => item.depth <= maxDepth);
}
