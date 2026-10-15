import { Link } from "@tanstack/react-router";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";
import { BlogCover } from "./blog-cover";
import { BlogEntryMeta } from "./blog-entry-meta";

interface BlogFeaturedEntryProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
}

/** A text-first lead; its single title link covers the complete list item. */
export function BlogFeaturedEntry({ entry, lang }: BlogFeaturedEntryProps) {
  return (
    <li className="blog-featured-entry blog-index-entry" data-blog-featured>
      <div className="min-w-0">
        <h2
          lang={entry.locale}
          className="text-2xl font-semibold leading-tight sm:text-3xl lg:text-4xl"
        >
          <Link
            to={blogPostPath(entry.locale, entry.slug)}
            hrefLang={entry.locale}
            className="blog-title-link after:absolute after:inset-0"
          >
            {entry.data.title}
          </Link>
        </h2>
        <p
          lang={entry.locale}
          className="mt-5 text-base leading-relaxed text-fd-muted-foreground sm:text-lg"
        >
          {entry.data.description}
        </p>
        <div className="mt-5">
          <BlogEntryMeta entry={entry} lang={lang} />
        </div>
      </div>
      {entry.data.image === undefined ? null : (
        <div className="blog-featured-cover min-w-0 overflow-hidden rounded-[var(--lore-radius-panel)]">
          <BlogCover entry={entry} priority className="block h-auto w-full" />
        </div>
      )}
    </li>
  );
}
