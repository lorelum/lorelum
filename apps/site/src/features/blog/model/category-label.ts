import { blogCategories, type BlogCategory } from "../content/frontmatter";

/**
 * Category → i18n key. A category is never rendered as its raw enum value:
 * the enum names the evidence source, the label is what a reader sees.
 */
export type CategoryLabelKey =
  | "blogCategoryBenchmark"
  | "blogCategoryPacks"
  | "blogCategoryLorelum";

const LABEL_KEYS: Record<BlogCategory, CategoryLabelKey> = {
  benchmark: "blogCategoryBenchmark",
  packs: "blogCategoryPacks",
  lorelum: "blogCategoryLorelum",
};

export function categoryLabelKey(category: BlogCategory): CategoryLabelKey {
  return LABEL_KEYS[category];
}

export function isBlogCategory(value: unknown): value is BlogCategory {
  return typeof value === "string" && (blogCategories as readonly string[]).includes(value);
}

/**
 * URL search value → category filter. Anything that is not one of the known
 * categories means "no filter": a stale or hand-edited `?category=` shows the
 * full index rather than an error page, and search params arrive as arrays when
 * a parameter is repeated, so a non-string is not a filter either.
 */
export function parseBlogCategory(value: unknown): BlogCategory | undefined {
  return isBlogCategory(value) ? value : undefined;
}
