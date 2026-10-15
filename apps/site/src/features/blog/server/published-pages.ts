import { isPostVisible } from "../model/post-visibility";
import { blogSource } from "./source";
import { pickFrontmatter } from "./pick-frontmatter";

/**
 * The blog pages that may be listed publicly, in both locales.
 *
 * The draft decision is not re-made here: this calls the same predicate the post
 * loader calls, with `isDevelopment` fixed to `false` — a sitemap is a list of
 * what should be indexed, and a draft is not published in any environment,
 * including the one the author is working in. Serving a draft at its URL in
 * development (so the author can read it) is the loader's separate use of the
 * same rule.
 */
export function getPublishedBlogPages() {
  return blogSource
    .getPages()
    .filter((page) =>
      isPostVisible({ draft: pickFrontmatter(page.data).draft, isDevelopment: false }),
    );
}
