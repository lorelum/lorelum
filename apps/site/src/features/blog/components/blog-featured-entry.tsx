import { Link } from "@tanstack/react-router";
import { blogPostPath } from "../model/blog-routes";
import { featuredTitleParts, keepTitlePartTogether } from "../model/featured-title";
import type { BlogIndexEntry } from "../model/list-posts";
import { BlogCover } from "./blog-cover";
import { BlogEntryMeta } from "./blog-entry-meta";

interface BlogFeaturedEntryProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
}

/**
 * The lead entry: one full-bleed image on the brand stage.
 *
 * The title, metadata and summary live in one reading block. On a fine pointer
 * a scrim grows over the image on hover or keyboard focus and the title and
 * metadata slide up onto it as plain text (see `blog.css`); the summary is
 * hidden visually there. Everywhere else, including touch screens that cannot
 * hover, the whole block sits below the stage, so no device loses the title.
 * It stays in the DOM and the accessibility tree either way, and the title
 * link stretches over the whole entry, so it is still the only interactive
 * element.
 */
export function BlogFeaturedEntry({ entry, lang }: BlogFeaturedEntryProps) {
  return (
    <li className="blog-featured-entry relative cursor-pointer" data-blog-featured>
      <div className="blog-featured-stage overflow-hidden bg-[var(--lore-brand-deep)]">
        <div className="blog-featured-cover aspect-[8/5] w-full min-w-0 lg:aspect-[21/9]">
          <BlogCover entry={entry} priority className="h-full w-full object-cover" />
        </div>
      </div>
      <div className="blog-featured-reading px-6 py-8 sm:px-8 sm:py-10 xl:px-12">
        <h2 lang={entry.locale} className="min-w-0 text-balance text-2xl font-semibold leading-[1.2] sm:text-3xl lg:text-4xl">
          <Link
            to={blogPostPath(entry.locale, entry.slug)}
            hrefLang={entry.locale}
            className="blog-title-link rounded-sm after:absolute after:inset-0"
          >
            {featuredTitleParts(entry.data.title).map((part, index) => (
              keepTitlePartTogether(part) ? <span key={index} className="inline-block">{part}</span> : part
            ))}
          </Link>
        </h2>
        <div className="mt-6">
          <BlogEntryMeta entry={entry} lang={lang} />
        </div>
        <p lang={entry.locale} className="blog-featured-summary mt-6 max-w-[var(--blog-measure)] text-base leading-relaxed text-fd-foreground sm:text-lg">
          {entry.data.description}
        </p>
      </div>
    </li>
  );
}
