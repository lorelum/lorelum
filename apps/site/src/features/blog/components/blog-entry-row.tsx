import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { BlogCover } from "./blog-cover";
import { BlogFeaturedEntry } from "./blog-featured-entry";
import { categoryLabelKey } from "../model/category-label";
import { languageHintKey } from "../model/entry-meta";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";

interface BlogEntryRowProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
  readonly featured?: boolean;
}

/**
 * One entry of the index, as a card.
 *
 * It used to be a bare row — no surface, no radius — on the argument that a row in
 * a sequence is not a card. Review saw the result: a list of pure text with no
 * structure to rest on. The card is the fix, and it stays inside the design
 * system's rules: a tonal surface (`--blog-quiet-surface`), the `panel` radius, and
 * layering by typography rather than by decoration.
 *
 * The cover stays beside the text above the narrowest viewports. Every card
 * carries art — `BlogCover` generates one when the post has none.
 *
 * The whole card is clickable while the title stays the only interactive element:
 * the link stretches over the card with `after:absolute after:inset-0` instead of
 * the card becoming a link, which would put a heading inside a link and swallow the
 * per-locale `lang` attributes the metadata needs.
 *
 * The link targets the entry's own locale: the index merges both locales, so an
 * entry can be listed on a page whose language it was never written in, and a
 * page-locale href would 404.
 */
export function BlogEntryRow({ entry, lang, featured = false }: BlogEntryRowProps) {
  if (featured) return <BlogFeaturedEntry entry={entry} lang={lang} />;
  const t = getStrings(lang);
  const hintKey = languageHintKey(entry.locale, lang);
  const coverSize = "sm:aspect-[16/10] sm:w-44 md:aspect-square xl:w-60";

  return (
    <li className="relative rounded-[var(--lore-radius-panel)] border border-[var(--blog-hairline)] bg-[var(--blog-quiet-surface)] p-4 transition-[box-shadow,border-color,background-color] duration-200 focus-within:border-[var(--border-strong)] focus-within:shadow-[var(--lore-shadow-lift)] hover:border-[var(--border-strong)] hover:shadow-[var(--lore-shadow-lift)] sm:p-5 lg:p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start xl:gap-8">
        <div className={`aspect-[16/9] w-full shrink-0 overflow-hidden rounded-sm ${coverSize}`}>
          <BlogCover entry={entry} className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3 text-xs text-fd-muted-foreground">
            <time dateTime={entry.data.date} className="tabular-nums">
              {entry.data.date}
            </time>
            <span data-blog-category={entry.data.category} className="rounded-full border border-[var(--input)] px-2.5 py-0.5 font-medium">{t[categoryLabelKey(entry.data.category)]}</span>
          </div>

          {/* The design system's title role is weight 600. On the latin side the
              display face carries the hierarchy; on the zh side the heading falls
              back to the reading face (the display face has no CJK glyphs), so
              there the weight step is the only contrast the title has left. */}
          <h2 lang={entry.locale} className="mt-3 text-xl font-semibold leading-snug lg:text-2xl">
            <Link
              to={blogPostPath(entry.locale, entry.slug)}
              hrefLang={entry.locale}
              className="blog-title-link rounded-sm after:absolute after:inset-0"
            >
              {entry.data.title}
            </Link>
          </h2>

          {hintKey ? <p className="mt-1 text-xs text-fd-muted-foreground">{t[hintKey]}</p> : null}

          <p lang={entry.locale} className="mt-4 leading-relaxed text-fd-muted-foreground">
            {entry.data.description}
          </p>
        </div>
      </div>
    </li>
  );
}
