import { filterBlogIndex, type BlogIndexEntry } from "./list-posts";
import { parseBlogQuery, searchBlogIndex } from "./search-posts";
import { sortBlogIndex, type BlogSort } from "./sort-posts";
import type { BlogCategory } from "../content/frontmatter";

export function blogDialogResults(
  posts: readonly BlogIndexEntry[],
  query: string,
  category: BlogCategory | undefined,
  sort: BlogSort,
): BlogIndexEntry[] {
  if (parseBlogQuery(query) === undefined) return [];
  return sortBlogIndex(searchBlogIndex(filterBlogIndex(posts, category), query), sort);
}
