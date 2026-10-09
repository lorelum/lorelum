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
 * One entry of the index after the lead stage, as a separator-led list item.
 *
 * v2 (redesign-site-blog-v2) replaces the v1 card: a tonal surface, border and
 * radius made every entry a box, and boxes inside a reading column read as
 * product panels. A hairline above each item gives the same sequence without a
 * frame. Hover and focus take a faint tonal wash; the cover keeps its scale
 * feedback. The rule is one hairline per item, never a card around it.
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
  const coverSize = "sm:w-44 xl:w-60";

  return (
    <li className="blog-entry-row relative cursor-pointer border-t border-[var(--blog-hairline)] py-6 transition-colors duration-200 hover:bg-[var(--blog-quiet-surface)] focus-within:bg-[var(--blog-quiet-surface)] sm:py-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start xl:gap-8">
        <div className={`aspect-[8/5] w-full shrink-0 overflow-hidden rounded-sm bg-[var(--lore-brand-deep)] ${coverSize}`}>
          <BlogCover entry={entry} className="h-full w-full object-contain" />
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
