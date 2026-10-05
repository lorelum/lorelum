import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import { categoryLabelKey } from "../model/category-label";
import type { BlogIndexEntry } from "../model/list-posts";
import { blogSorts, type BlogSort } from "../model/sort-posts";
import { offeredCategories } from "../model/sidebar-categories";
import { parseBlogQuery } from "../model/search-posts";

const sortLabelKey = {
  newest: "blogSortNewest",
  oldest: "blogSortOldest",
  "title-asc": "blogSortTitleAsc",
  "title-desc": "blogSortTitleDesc",
} as const;

interface BlogIndexControlsProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
  readonly category?: BlogCategory;
  readonly sort: BlogSort;
  readonly q?: string;
}

export function BlogIndexControls({ lang, posts, category, sort, q }: BlogIndexControlsProps) {
  const t = getStrings(lang);
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState(q ?? "");
  useEffect(() => {
    setSearchInput(q ?? "");
  }, [category, sort, q]);
  const categories = offeredCategories(posts);
  const filtering = category !== undefined || sort !== "newest" || q !== undefined;
  const pill = (active: boolean) =>
    `inline-flex min-h-[var(--lore-size-touch)] min-w-[var(--lore-size-touch)] items-center justify-center rounded-full px-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${
      active
        ? "bg-[var(--accent)] font-medium text-[var(--accent-foreground)]"
        : "text-fd-muted-foreground hover:bg-[var(--blog-quiet-surface)] hover:text-fd-foreground"
    }`;

  return (
    <div className="blog-index-toolbar grid gap-2 border-b border-[var(--blog-hairline)] px-6 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center xl:px-12">
      <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-1">
        <section aria-label={t.blogFilterCategory}>
          <p className="sr-only">{t.blogFilterCategory}</p>
          <ul data-blog-controls="category" className="flex flex-wrap gap-1.5">
            <li>
              <Link
                to={blogIndexPath(lang)}
                search={{ category: undefined, sort, q }}
                activeOptions={{ exact: true, includeSearch: true }}
                aria-current={category === undefined ? "true" : undefined}
                className={pill(category === undefined)}
              >
                {t.blogAllCategories}
              </Link>
            </li>
            {categories.map((candidate) => (
              <li key={candidate}>
                <Link
                  to={blogIndexPath(lang)}
                  search={{ category: candidate, sort, q }}
                  activeOptions={{ exact: true, includeSearch: true }}
                  aria-current={candidate === category ? "true" : undefined}
                  className={pill(candidate === category)}
                >
                  {t[categoryLabelKey(candidate)]}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label={t.blogSortBy}>
          <p className="sr-only">{t.blogSortBy}</p>
          <ul data-blog-controls="sort" className="flex flex-wrap gap-1.5">
            {blogSorts.map((candidate) => (
              <li key={candidate}>
                <Link
                  to={blogIndexPath(lang)}
                  search={{ category, sort: candidate, q }}
                  activeOptions={{ exact: true, includeSearch: true }}
                  aria-current={candidate === sort ? "true" : undefined}
                  className={pill(candidate === sort)}
                >
                  {t[sortLabelKey[candidate]]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <form
          role="search"
          method="get"
          action={blogIndexPath(lang)}
          onSubmit={(event) => {
            event.preventDefault();
            void navigate({
              to: blogIndexPath(lang),
              search: { category, sort, q: parseBlogQuery(searchInput) },
            });
          }}
          className="flex min-w-0 flex-1 items-center rounded-[var(--radius)] border border-[var(--input)] bg-[var(--background)] p-1 lg:w-72"
        >
          <label htmlFor="blog-search" className="sr-only">{t.blogSearch}</label>
          <input
            id="blog-search"
            type="search"
            name="q"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            autoComplete="off"
            maxLength={200}
            placeholder={t.blogSearchPlaceholder}
            className="min-h-[var(--lore-size-touch)] min-w-0 flex-1 rounded-sm bg-transparent px-3 text-sm text-fd-foreground placeholder:text-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          />
          {category === undefined ? null : <input type="hidden" name="category" value={category} />}
          <input type="hidden" name="sort" value={sort} />
          <button
            type="submit"
            aria-label={t.blogSearch}
            className="inline-flex min-h-[var(--lore-size-touch)] min-w-[var(--lore-size-touch)] items-center justify-center rounded-sm text-fd-muted-foreground transition-colors hover:bg-[var(--accent)] hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Search size={18} aria-hidden="true" />
          </button>
        </form>
        {filtering ? (
          <Link
            to={blogIndexPath(lang)}
            search={{ category: undefined, sort: undefined, q: undefined }}
            activeOptions={{ exact: true, includeSearch: true }}
            className="blog-nav-link inline-flex min-h-[var(--lore-size-touch)] shrink-0 items-center rounded-sm px-2 text-sm"
          >
            {t.blogReset}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
