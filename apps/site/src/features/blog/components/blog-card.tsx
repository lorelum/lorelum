import { Link } from "@tanstack/react-router";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";
import { BlogCover } from "./blog-cover";
import { BlogEntryMeta } from "./blog-entry-meta";

interface BlogCardProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
}

/** A cover-first index card with complete text and one stretched title link. */
export function BlogCard({ entry, lang }: BlogCardProps) {
  return (
    <li
      className="blog-index-entry min-w-0 overflow-hidden rounded-[var(--lore-radius-panel)] bg-fd-card"
      data-blog-card
    >
      {entry.data.image === undefined ? null : (
        <BlogCover entry={entry} className="blog-index-cover block h-auto w-full" />
      )}
      <div className="min-w-0 p-6 sm:p-7">
        <h2 lang={entry.locale} className="text-xl font-semibold leading-snug sm:text-2xl">
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
          className="mt-4 text-sm leading-relaxed text-fd-muted-foreground sm:text-base"
        >
          {entry.data.description}
        </p>
        <div className="mt-6">
          <BlogEntryMeta entry={entry} lang={lang} />
        </div>
      </div>
    </li>
  );
}
