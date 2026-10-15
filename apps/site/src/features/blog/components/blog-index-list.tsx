import type { BlogIndexLayout } from "../model/index-layout";
import { BlogCard } from "./blog-card";
import { BlogFeaturedEntry } from "./blog-featured-entry";

interface BlogIndexListProps {
  readonly layout: BlogIndexLayout;
  readonly lang: string;
}

/** A single ordered reading sequence, with an optional full-width lead. */
export function BlogIndexList({ layout, lang }: BlogIndexListProps) {
  return (
    <ul className="blog-index-list">
      {layout.featured === undefined ? null : (
        <BlogFeaturedEntry
          key={`${layout.featured.slug}-${layout.featured.locale}`}
          entry={layout.featured}
          lang={lang}
        />
      )}
      {layout.posts.map((entry) => (
        <BlogCard key={`${entry.slug}-${entry.locale}`} entry={entry} lang={lang} />
      ))}
    </ul>
  );
}
