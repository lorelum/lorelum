import { blogFrontmatterSchema, type BlogFrontmatter } from "../content/frontmatter";

/**
 * Serializable, validated projection of a source page's frontmatter. Async
 * Fumadocs collections attach helper functions (e.g. `getText`) to
 * `page.data`, and the loader's static type falls back to the default page
 * schema, so the blog schema is re-run here: it strips the helpers, keeps the
 * route payload plain, and fails fast on frontmatter that drifts from the
 * contract (including during prerender).
 */
export function pickFrontmatter(data: unknown): BlogFrontmatter {
  return blogFrontmatterSchema.parse(data);
}
