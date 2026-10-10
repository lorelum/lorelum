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

export function BlogFeaturedEntry({ entry, lang }: BlogFeaturedEntryProps) {
  return (
    <li className="blog-featured-entry relative cursor-pointer" data-blog-featured>
      <div className="blog-featured-stage grid items-center gap-6 rounded-[var(--lore-radius-stage)] bg-[var(--lore-brand-deep)] px-6 py-8 text-[var(--background)] dark:text-[var(--foreground)] sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10 xl:px-12 xl:py-12">
        <h2 lang={entry.locale} className="min-w-0 text-balance text-3xl font-semibold leading-[1.15] sm:text-4xl lg:text-5xl xl:text-[length:var(--lore-text-display)]">
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
        <div className="blog-featured-cover aspect-[8/5] w-full min-w-0">
          <BlogCover entry={entry} priority className="h-full w-full object-contain" />
        </div>
      </div>
      <div className="blog-featured-reading px-6 py-8 sm:px-8 sm:py-10 xl:px-12">
        <BlogEntryMeta entry={entry} lang={lang} />
        <p lang={entry.locale} className="mt-6 max-w-[var(--blog-measure)] text-base leading-relaxed text-fd-foreground sm:text-lg">
          {entry.data.description}
        </p>
      </div>
    </li>
  );
}
