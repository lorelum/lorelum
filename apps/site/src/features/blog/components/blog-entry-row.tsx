import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { BlogCover } from "./blog-cover";
import { CategoryChip } from "./category-chip";
import { languageHintKey } from "../model/entry-meta";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";

interface BlogEntryRowProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
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
 * The card's shape follows the reference indexes the maintainer pointed at
 * (OpenAI's and Claude's): cover art on the left, text on the right, stacked
 * under the narrowest viewports. Every card carries art — `BlogCover` generates
 * one when the post has none — because a text-only card is what read as
 * "childish" about the previous list.
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
export function BlogEntryRow({ entry, lang }: BlogEntryRowProps) {
  const t = getStrings(lang);
  const hintKey = languageHintKey(entry.locale, lang);

  return (
    <li className="relative rounded-[var(--lore-radius-panel)] border border-[var(--blog-hairline)] bg-[var(--blog-quiet-surface)] p-5 transition-[box-shadow,border-color,background-color] duration-200 focus-within:border-[var(--border-strong)] focus-within:shadow-[var(--lore-shadow-lift)] hover:border-[var(--border-strong)] hover:shadow-[var(--lore-shadow-lift)] sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        {/* The cover is inset, not bleeding to the card's edge: the reference
            thumbs are framed blocks inside their cards, and the hairline keeps
            the generated branch — flat tints — from dissolving into the card's
            own tonal surface. */}
        <div className="aspect-[16/9] w-full shrink-0 overflow-hidden rounded-[var(--lore-radius)] border border-[var(--blog-hairline)] sm:aspect-square sm:w-44">
          <BlogCover entry={entry} className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0 flex-1">
          {/* The design system's title role is weight 600. On the latin side the
              display face carries the hierarchy; on the zh side the heading falls
              back to the reading face (the display face has no CJK glyphs), so
              there the weight step is the only contrast the title has left. */}
          <h2 lang={entry.locale} className="text-xl font-semibold leading-snug">
            <Link
              to={blogPostPath(entry.locale, entry.slug)}
              hrefLang={entry.locale}
              className="blog-title-link rounded-sm after:absolute after:inset-0"
            >
              {entry.data.title}
            </Link>
          </h2>

          {hintKey ? <p className="mt-1 text-xs text-fd-muted-foreground">{t[hintKey]}</p> : null}

          {/* The category is a Badge in the design system's sense — short text that
              does not pretend to be a button — and it is the same chip the article's
              metadata line renders, so the two surfaces agree. The line sits at the
              caption size so date and chip read as metadata under a title whose face
              or weight already marks it as the card's peak. */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fd-muted-foreground">
            <time dateTime={entry.data.date} className="tabular-nums">
              {entry.data.date}
            </time>
            <CategoryChip lang={lang} category={entry.data.category} pill />
          </div>

          <p lang={entry.locale} className="mt-3 leading-relaxed text-fd-muted-foreground">
            {entry.data.description}
          </p>
        </div>
      </div>
    </li>
  );
}
