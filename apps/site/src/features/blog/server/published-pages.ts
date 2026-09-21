import { blogSource } from "./source";
import { pickFrontmatter } from "./pick-frontmatter";

/**
 * The blog pages that may be listed publicly, in both locales.
 *
 * Drafts are excluded here rather than at each call site: the sitemap is a list
 * of what should be indexed, and a draft is not published in any environment,
 * including the one the author is working in. Serving a draft at its URL in
 * development (so the author can read it) is a separate decision, made by
 * `isPostVisible` in the post loader.
 */
export function getPublishedBlogPages() {
  return blogSource
    .getPages()
    .filter((page) => !pickFrontmatter(page.data).draft);
}
