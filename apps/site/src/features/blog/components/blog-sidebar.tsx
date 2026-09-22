import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath, blogPostPath } from "../model/blog-routes";
import { categoryLabelKey } from "../model/category-label";
import type { BlogIndexEntry } from "../model/list-posts";
import { offeredCategories } from "../model/sidebar-categories";

/**
 * The blog's own navigation, as the shell's left column.
 *
 * Both sections come from the post list the route already built — there is no
 * second data source and no new frontmatter field. The list is the same one the
 * index renders, so a post that is listed is navigable and a draft is not.
 *
 * At one post this is a one-row list under one category — thinned, not empty, and
 * structurally the same shape it will have at fifty. That is the deliberate
 * trade: the column is navigation, not decoration, so it does not need filling.
 *
 * Rows carry symmetric horizontal padding because the marked row's tint *is* the
 * padding box: with padding on one side only, the highlight starts at the glyphs
 * and runs past them, which reads as a mistake rather than a state.
 */
interface BlogSidebarProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
  /** The category the index is currently filtered by, when one is active. */
  readonly category?: BlogCategory;
}

export function BlogSidebar({ lang, posts, category }: BlogSidebarProps) {
  const t = getStrings(lang);
  // Offered categories come from the entries, not from the vocabulary: the
  // sidebar must not advertise a destination that renders an empty list.
  const offered = offeredCategories(posts);

  return (
    <nav aria-label={t.navBlog} className="text-sm">
      <p className="text-fd-muted-foreground">{t.blogAllPosts}</p>
      <ul className="mt-3 space-y-1">
        {posts.map((entry) => (
            <li key={`${entry.slug}-${entry.locale}`}>
              <Link
                to={blogPostPath(entry.locale, entry.slug)}
                // Contextual links mark themselves only when the reader is
                // actually on that page, the same rule the article's own links
                // follow; the sidebar is not a landmark for the site's top-level
                // destinations.
                activeOptions={{ exact: true }}

                className="blog-nav-link block rounded-sm px-2 py-1"
              >
                {entry.data.title}
              </Link>
            </li>
        ))}
      </ul>

      {offered.length === 0 ? null : (
        <>
          <p className="mt-8 text-fd-muted-foreground">{t.blogCategories}</p>
          <ul className="mt-3 space-y-1">
            {offered.map((candidate) => (
              <li key={candidate}>
                <Link
                  to={blogIndexPath(lang)}
                  search={{ category: candidate }}
                  aria-current={candidate === category ? "true" : undefined}
                  className="blog-nav-link block rounded-sm px-2 py-1"
                >
                  {t[categoryLabelKey(candidate)]}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
