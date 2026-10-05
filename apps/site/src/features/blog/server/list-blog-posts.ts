import { i18n } from "@/shared/i18n/config";
import type { BlogCategory } from "../content/frontmatter";
import { buildBlogIndex, filterBlogIndex, type BlogPostRecord } from "../model/list-posts";
import { defaultBlogSort, sortBlogIndex, type BlogSort } from "../model/sort-posts";
import { parseBlogQuery, searchBlogIndex } from "../model/search-posts";
import { pickFrontmatter } from "./pick-frontmatter";
import { blogSource } from "./source";

/**
 * Builds the deterministic blog index for one locale from the full source
 * (both locales are indexed by the Fumadocs source; merging happens in the
 * pure model so it stays testable without a filesystem).
 *
 * The category and search match is computed here and returned as slugs beside the complete
 * visible list. The screen can render only matching cards while keeping every
 * valid category and article link available. This narrowing describes what the
 * renderer receives when it actually runs: on the prerendered canonical index
 * there is no category or query, and a query URL is answered by that static page before
 * any server function sees one (see the controls' comment for the full picture).
 *
 * Visibility is the article loader's own rule (`isPostVisible`), with the same
 * environment input: while developing, the index lists a draft because its URL
 * answers; in a build it does not, because that URL 404s.
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
