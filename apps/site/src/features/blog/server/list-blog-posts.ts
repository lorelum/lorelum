import { i18n } from "@/shared/i18n/config";
import type { BlogCategory } from "../content/frontmatter";
import { buildBlogIndex, filterBlogIndex, type BlogPostRecord } from "../model/list-posts";
import { defaultBlogSort, sortBlogIndex, type BlogSort } from "../model/sort-posts";
import { parseBlogQuery, searchBlogIndex } from "../model/search-posts";
import { pickFrontmatter } from "./pick-frontmatter";
import { blogSource } from "./source";

/**
 * Merge the locale versions using the article loader's visibility rule.
 * Return matching slugs separately so filtering cards preserves the full
 * navigation list and category choices.
 */
export function listBlogIndex(
  lang: string,
  category?: BlogCategory,
  sort: BlogSort = defaultBlogSort,
  query?: string,
) {
  const records: BlogPostRecord[] = blogSource.getPages().map((page) => ({
    slug: page.slugs.join("/"),
    locale: page.locale ?? i18n.defaultLanguage,
    data: pickFrontmatter(page.data),
  }));

  // Keep every visible post for navigation and filter choices. Only the cards
  // are narrowed by category and search; their slugs avoid duplicating post data.
  const posts = sortBlogIndex(
    buildBlogIndex(records, lang, { isDevelopment: import.meta.env.DEV }),
    sort,
  );
  const q = parseBlogQuery(query);
  const filteredPostSlugs =
    category === undefined && q === undefined
      ? undefined
      : searchBlogIndex(filterBlogIndex(posts, category), q).map((entry) => entry.slug);

  return {
    posts,
    ...(filteredPostSlugs === undefined ? {} : { filteredPostSlugs }),
  };
}

export function listBlogPosts(
  lang: string,
  category?: BlogCategory,
  sort: BlogSort = defaultBlogSort,
) {
  const { posts, filteredPostSlugs } = listBlogIndex(lang, category, sort);
  if (filteredPostSlugs === undefined) return posts;

  const selected = new Set(filteredPostSlugs);
  return posts.filter((entry) => selected.has(entry.slug));
}
