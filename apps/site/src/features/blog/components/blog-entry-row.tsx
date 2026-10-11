import { Link } from "@tanstack/react-router";
import { BlogCover } from "./blog-cover";
import { BlogEntryMeta } from "./blog-entry-meta";
import { BlogFeaturedEntry } from "./blog-featured-entry";
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
 * v2 replaced the v1 card with a hairline above each item; v2.1 sets the rows
 * on a 5:7 grid (cover : text) with generous vertical rhythm, and puts the
 * metadata block, which opens with the date tile, above the title. Hover and
 * focus take a faint tonal wash, and the cover keeps its scale feedback.
 *
 * The cover is never covered: its corners carry authored labels, so the date
 * tile lives in the metadata block instead of overlapping the image.
 *
 * The whole row is clickable while the title stays the only interactive
 * element: the link stretches over the row with `after:absolute after:inset-0`
 * instead of the row becoming a link, which would put a heading inside a link
 * and swallow the per-locale `lang` attributes the metadata needs.
 *
 * The link targets the entry's own locale: the index merges both locales, so an
 * entry can be listed on a page whose language it was never written in, and a
 * page-locale href would 404.
 */
export function BlogEntryRow({ entry, lang, featured = false }: BlogEntryRowProps) {
  if (featured) return <BlogFeaturedEntry entry={entry} lang={lang} />;

  return (
    <li className="blog-entry-row relative cursor-pointer border-t border-[var(--blog-hairline)] px-6 py-8 transition-colors duration-200 hover:bg-[var(--blog-quiet-surface)] focus-within:bg-[var(--blog-quiet-surface)] lg:py-12 xl:px-12">
      <div className="grid items-start gap-6 md:grid-cols-[5fr_7fr] md:gap-8 xl:gap-12">
        <div className="blog-entry-cover aspect-[8/5] w-full overflow-hidden bg-[var(--lore-brand-deep)]">
          <BlogCover entry={entry} className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0">
          <BlogEntryMeta entry={entry} lang={lang} />

          {/* The design system's title role is weight 600. On the latin side the
              display face carries the hierarchy; on the zh side the heading falls
              back to the reading face (the display face has no CJK glyphs), so
              there the weight step is the only contrast the title has left. */}
          <h2 lang={entry.locale} className="mt-5 text-xl font-semibold leading-snug lg:text-2xl">
            <Link
              to={blogPostPath(entry.locale, entry.slug)}
              hrefLang={entry.locale}
              className="blog-title-link rounded-sm after:absolute after:inset-0"
            >
              {entry.data.title}
            </Link>
          </h2>

          <p lang={entry.locale} className="mt-4 max-w-[var(--blog-measure)] leading-relaxed text-fd-muted-foreground">
            {entry.data.description}
          </p>
        </div>
      </div>
    </li>
  );
}
