import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import { categoryLabelKey } from "../model/category-label";

interface CategoryChipProps {
  readonly lang: string;
  readonly category: BlogCategory;
  /**
   * Draws a hairline pill around the label. The article's metadata line is
   * denser than an index row, so there the category reads as a control rather
   * than as running text.
   */
  readonly pill?: boolean;
}

/**
 * The category entry: a real, shareable URL for one category of the index.
 *
 * It is deliberately not a coloured chip. The palette has a single saturated
 * brand channel, so three category hues would introduce a decorative colour
 * system the design system does not define; the category is distinguished by
 * weight and by being a link, not by hue.
 */
export function CategoryChip({ lang, category, pill = false }: CategoryChipProps) {
  const t = getStrings(lang);

  return (
    <Link
      to={blogIndexPath(lang)}
      search={{ category }}
      className={`blog-nav-link font-medium ${
        pill ? "rounded-full border border-[var(--input)] px-2.5 py-0.5" : "rounded-sm"
      }`}
      data-blog-category={category}
    >
      {t[categoryLabelKey(category)]}
    </Link>
  );
}
