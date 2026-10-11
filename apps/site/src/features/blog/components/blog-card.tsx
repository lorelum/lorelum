import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { categoryLabelKey } from "../model/category-label";
import { languageHintKey } from "../model/entry-meta";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";
import { BlogCover } from "./blog-cover";
import { BlogEntryMeta } from "./blog-entry-meta";

export type BlogCardVariant = "grid" | "band" | "feature" | "thumb";

interface BlogCardProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
  readonly variant: BlogCardVariant;
  /** Placement classes from the list that holds this item. */
  readonly className?: string;
  /** Custom properties the list sets for this item's placement. */
  readonly style?: CSSProperties;
}

const shell: Record<BlogCardVariant, string> = {
  grid: "flex-col border border-[var(--blog-hairline)]",
  feature: "flex-col border border-[var(--blog-hairline)]",
  band: "flex-col bg-[var(--blog-quiet-surface)] md:grid md:grid-cols-[7fr_5fr] md:items-center",
  thumb: "flex-row items-center gap-4 border-t border-[var(--blog-hairline)] py-4",
};

const coverBox: Record<BlogCardVariant, string> = {
  grid: "aspect-[16/9] w-full",
  feature: "aspect-[16/10] w-full",
  band: "aspect-[16/9] w-full md:aspect-[16/10]",
  thumb: "aspect-[4/3] w-28 shrink-0 sm:w-36",
};

const titleSize: Record<BlogCardVariant, string> = {
  grid: "text-lg leading-snug",
  feature: "text-xl leading-snug lg:text-2xl",
  band: "text-xl leading-snug lg:text-3xl",
  thumb: "text-base leading-snug",
};

/**
 * One index entry that is not the lead, in one of four shapes: a grid card, a
 * full-width band, the split's feature card, or a thumbnail row.
 *
 * Every shape keeps the lead's contract: the cover is never covered, the title
 * link is the only interactive element and stretches over the whole card with
 * `after:absolute after:inset-0`, and the link targets the entry's own locale
 * because the index merges both locales (a page-locale href would 404). The
 * thumbnail has no metadata block, so it carries the language hint beside the
 * category: an entry that exists only in the other language must still say so.
 * The hover and focus feedback is a tonal wash plus the shared cover zoom
 * (`.blog-card` in `blog.css`); touch screens simply never hover.
 */
export function BlogCard({ entry, lang, variant, className = "", style }: BlogCardProps) {
  const t = getStrings(lang);
  const compact = variant === "thumb";
  const hintKey = languageHintKey(entry.locale, lang);

  return (
    <li
      className={`blog-card relative flex min-w-0 cursor-pointer transition-colors duration-200 hover:bg-[var(--blog-quiet-surface)] focus-within:bg-[var(--blog-quiet-surface)] ${shell[variant]} ${className}`}
      data-blog-card={variant}
      style={style}
    >
      <div className={`blog-card-cover overflow-hidden bg-[var(--lore-brand-deep)] ${coverBox[variant]}`}>
        <BlogCover entry={entry} className="h-full w-full object-cover" />
      </div>

      <div className={compact ? "min-w-0" : "min-w-0 p-5 sm:p-6 lg:p-8"}>
        {compact ? null : <BlogEntryMeta entry={entry} lang={lang} />}
        <h2 lang={entry.locale} className={`${compact ? "" : "mt-5 "}font-semibold ${titleSize[variant]}`}>
          <Link
            to={blogPostPath(entry.locale, entry.slug)}
            hrefLang={entry.locale}
            className="blog-title-link rounded-sm after:absolute after:inset-0"
          >
            {entry.data.title}
          </Link>
        </h2>
        {compact ? (
          <p className="mt-1 text-xs text-fd-muted-foreground">
            {t[categoryLabelKey(entry.data.category)]}
            {hintKey === undefined ? null : ` · ${t[hintKey]}`}
          </p>
        ) : (
          <p lang={entry.locale} className="mt-3 leading-relaxed text-fd-muted-foreground">
            {entry.data.description}
          </p>
        )}
      </div>
    </li>
  );
}
