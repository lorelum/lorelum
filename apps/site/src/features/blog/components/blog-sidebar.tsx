import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogPostPath } from "../model/blog-routes";
import type { BlogSort } from "../model/sort-posts";
import { BlogIndexControls } from "./blog-index-controls";
import type { BlogIndexEntry } from "../model/list-posts";

/**
 * The blog's own navigation, as the shell's left column.
 *
 * The route passes the complete visible list, even while cards are filtered.
 * There is no second data source or new frontmatter field, and every post stays
 * reachable when the reader changes categories.
 *
 * At one post this is a one-row list — thinned, not empty, and structurally the same
 * shape it will have at fifty. That is the deliberate trade: the column is
 * navigation, not decoration, so it does not need filling.
 *
 * Rows carry symmetric horizontal padding because the marked row's tint *is* the
 * padding box: with padding on one side only, the highlight starts at the glyphs and
 * runs past them, which reads as a mistake rather than a state.
 *
 * The column also carries the index's filter and sort controls, which is where they
 * belong: they are navigation over the list, not a toolbar over the content. (They
 * were a strip across the top of the index; review called it ugly, and it was — a
 * full-width row of controls above the content competes with the content.)
 */
interface BlogSidebarProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
  /**
   * Where the reader is in the index, when this column is rendered beside it. Both
   * are URL state. They are absent on the article page, where the controls are not
   * rendered: a sort control that cannot affect the page the reader is on is a
   * control that does nothing.
   */
  readonly category?: BlogCategory;
  readonly sort?: BlogSort;
}

export function BlogSidebar({ lang, posts, category, sort }: BlogSidebarProps) {
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

      {sort === undefined ? null : (
        <BlogIndexControls lang={lang} posts={posts} category={category} sort={sort} />
      )}
    </nav>
  );
}
