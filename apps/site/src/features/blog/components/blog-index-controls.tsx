import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import { categoryLabelKey } from "../model/category-label";
import type { BlogIndexEntry } from "../model/list-posts";
import { blogSorts, type BlogSort } from "../model/sort-posts";
import { offeredCategories } from "../model/sidebar-categories";

const sortLabelKey = {
  newest: "blogSortNewest",
  oldest: "blogSortOldest",
  "title-asc": "blogSortTitleAsc",
  "title-desc": "blogSortTitleDesc",
} as const;

/**
 * The index's filter and sort links, shown in the sidebar on desktop and above
 * the cards on narrower viewports.
 *
 * They were a bar across the top of the list; review called that ugly, and it was:
 * a full-width strip of controls above the content competes with the content and
 * reads as chrome. In the column they sit with the rest of the navigation, where a
 * reader already looks for "what else is here".
 *
 * Both are URL state, not component state: a filtered or re-sorted list is a
 * link a reader can share, and every option — category and ordering alike — is
 * a plain link carrying the full search state, so changing either is one
 * navigation, with nothing to apply and nothing that only works scripted.
 *
 * What a query URL serves is the prerendered index: the static assets answer
 * it before any server function runs, so the narrowed list renders once
 * scripts hydrate. A no-JS reader who follows the link gets the full index —
 * never an error, never a half-applied state — which is the honest floor this
 * deployment gives, and the spec states it the same way.
 *
 * The ordering was a GET form with a native select until review rejected the
 * select's open state: the popup is platform chrome no stylesheet reaches, so it
 * looked foreign in both themes. Links cannot have that problem — their resting
 * state is their only state.
 *
 * Sizing follows the design system rather than the list: every option here is at
 * least `--lore-size-touch` tall and takes the shared focus ring. The categories
 * read as full rows of navigation; the orderings are inline pills, so the two
 * sections differ in shape the way they differ in kind.
 */
interface BlogIndexControlsProps {
  readonly lang: string;
  /** Complete visible index, before the active category filter. */
  readonly posts: readonly BlogIndexEntry[];
  readonly category?: BlogCategory;
  readonly sort: BlogSort;
}

export function BlogIndexControls({ lang, posts, category, sort }: BlogIndexControlsProps) {
  const t = getStrings(lang);
  const categories = offeredCategories(posts);
  const filtering = category !== undefined || sort !== "newest";

  // One row shape for every option, selected or not: the tint *is* the padding box,
  // so the padding has to be symmetric or the highlight starts at the glyphs.
  const row = (active: boolean) =>
    `flex min-h-[var(--lore-size-touch)] items-center rounded-[var(--radius)] px-2 text-sm transition-colors ${
      active
        ? "bg-[var(--blog-quiet-surface)] font-medium text-fd-foreground"
        : "text-fd-muted-foreground hover:bg-[var(--blog-quiet-surface)] hover:text-fd-foreground"
    }`;

  // The same language as a row, drawn as a pill: inline, so the four orderings
  // read as one compact group rather than as four more rows of navigation.
  const pill = (active: boolean) =>
    `inline-flex min-h-[var(--lore-size-touch)] items-center rounded-full px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${
      active
        ? "bg-[var(--blog-quiet-surface)] font-medium text-fd-foreground"
        : "text-fd-muted-foreground hover:bg-[var(--blog-quiet-surface)] hover:text-fd-foreground"
    }`;

  return (
    <div className="mt-8 space-y-6">
      <section>
        <p className="text-fd-muted-foreground">{t.blogFilterCategory}</p>
        <ul className="mt-2 space-y-1">
          <li>
            <Link
              to={blogIndexPath(lang)}
              search={{ category: undefined, sort }}
              activeOptions={{ exact: true, includeSearch: true }}
              aria-current={category === undefined ? "true" : undefined}
              className={row(category === undefined)}
            >
              {t.blogAllCategories}
            </Link>
          </li>
          {categories.map((candidate) => (
            <li key={candidate}>
              <Link
                to={blogIndexPath(lang)}
                search={{ category: candidate, sort }}
                aria-current={candidate === category ? "true" : undefined}
                className={row(candidate === category)}
              >
                {t[categoryLabelKey(candidate)]}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="text-fd-muted-foreground">{t.blogSortBy}</p>
        {/* In the sidebar's column the four orderings become a two-column grid:
          wrapped pills there stranded a lone last row (measured at 1440:
          52/52/105/105px over two rows, the second half-empty), while the same
          group fits one row at 390px above the cards. Below the sidebar's
          breakpoint the strip spans the page, so it keeps the wrapping row. */}
        <ul className="mt-2 flex flex-wrap gap-1.5 lg:grid lg:grid-cols-2 lg:gap-1.5">
          {blogSorts.map((candidate) => (
            <li key={candidate}>
              <Link
                to={blogIndexPath(lang)}
                search={{ category, sort: candidate }}
                aria-current={candidate === sort ? "true" : undefined}
                className={pill(candidate === sort)}
              >
                {t[sortLabelKey[candidate]]}
              </Link>
            </li>
          ))}
        </ul>
        {filtering ? (
          <Link
            to={blogIndexPath(lang)}
            // Both params stripped, not inherited: a Link without `search`
            // keeps the current one, which would leave "reset" pointing at the
            // state it claims to clear.
            search={{ category: undefined, sort: undefined }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={`mt-1 ${row(false)}`}
          >
            {t.blogReset}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
