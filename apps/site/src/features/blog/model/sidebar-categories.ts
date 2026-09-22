import { blogCategories, type BlogCategory } from "../content/frontmatter";
import type { BlogIndexEntry } from "./list-posts";

/**
 * The categories the sidebar may offer: those a *visible* entry actually carries.
 *
 * The sidebar is navigation, so it must not advertise a destination that answers
 * with an empty list. Deriving the set from the same entries the index renders —
 * rather than from the frontmatter vocabulary — makes that impossible by
 * construction: a category disappears from the sidebar exactly when its last post
 * stops being visible (unpublished, drafted, or removed).
 *
 * The order is the vocabulary's, not the entries', so the list does not reshuffle
 * when a post is added.
 */
export function offeredCategories(
  entries: readonly BlogIndexEntry[],
): readonly BlogCategory[] {
  return blogCategories.filter((candidate) =>
    entries.some((entry) => entry.data.category === candidate),
  );
}
