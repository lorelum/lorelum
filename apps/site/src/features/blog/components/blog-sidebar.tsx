import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";

/**
 * The blog's own navigation, as the shell's left column.
 *
 * The article route passes the complete visible list. There is no second data
 * source or new frontmatter field, and every published post stays reachable.
 *
 * At one post this is a one-row list — thinned, not empty, and structurally the same
 * shape it will have at fifty. That is the deliberate trade: the column is
 * navigation, not decoration, so it does not need filling.
 *
 * Rows carry symmetric horizontal padding because the marked row's tint *is* the
 * padding box: with padding on one side only, the highlight starts at the glyphs and
 * runs past them, which reads as a mistake rather than a state.
 */
interface BlogSidebarProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
}

export function BlogSidebar({ lang, posts }: BlogSidebarProps) {
  const t = getStrings(lang);

  return (
    <nav aria-label={t.navBlog} className="text-sm">
      <p className="text-xs font-medium tracking-wide text-fd-muted-foreground">{t.blogAllPosts}</p>
      <ul className="mt-3 space-y-1">
        {posts.map((entry) => (
          <li key={`${entry.slug}-${entry.locale}`}>
            <Link
              to={blogPostPath(entry.locale, entry.slug)}
              // Contextual links mark themselves only when the reader is actually on
              // that page, the same rule the article's own links follow; the sidebar
              // is not a landmark for the site's top-level destinations.
              activeOptions={{ exact: true }}
              className="blog-nav-link flex min-h-[var(--lore-size-touch)] items-center rounded-sm px-2 py-2 text-fd-muted-foreground"
            >
              {entry.data.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
