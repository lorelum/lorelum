import { blogCategories, type BlogCategory } from "../content/frontmatter";
import type { BlogIndexEntry } from "./list-posts";

/**
 * The categories the sidebar may offer: those a *visible* entry actually carries.
 *
 * Derive choices from the complete visible index before applying the active
 * category filter. This keeps other valid destinations available while ensuring a
 * category disappears when its last post stops being visible (unpublished,
 * drafted, or removed).
 *
 * The order is the vocabulary's, not the entries', so the list does not reshuffle
 * when a post is added.
 */
export function offeredCategories(entries: readonly BlogIndexEntry[]): readonly BlogCategory[] {
  return blogCategories.filter((candidate) =>
    entries.some((entry) => entry.data.category === candidate),
  );
}
