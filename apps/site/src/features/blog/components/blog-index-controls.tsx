import { Link } from "@tanstack/react-router";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import { categoryLabelKey } from "../model/category-label";
import type { BlogIndexEntry } from "../model/list-posts";
import type { BlogSort } from "../model/sort-posts";
import { offeredCategories } from "../model/sidebar-categories";
import { BlogSearchDialog } from "./blog-search-dialog";

interface BlogIndexControlsProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
  readonly category?: BlogCategory;
  readonly sort: BlogSort;
  readonly q?: string;
}

export function BlogIndexControls({ lang, posts, category, sort, q }: BlogIndexControlsProps) {
  const t = getStrings(lang);
  const categories = offeredCategories(posts);
  const filtering = category !== undefined || sort !== "newest" || q !== undefined;
  const categoryLinkClass =
    "inline-flex min-h-[var(--lore-size-touch)] min-w-[var(--lore-size-touch)] shrink-0 items-center justify-center whitespace-nowrap font-[family-name:var(--lore-font-mono)] text-sm font-medium tracking-wide text-fd-muted-foreground uppercase no-underline transition-colors hover:text-fd-foreground aria-[current=page]:text-fd-foreground aria-[current=page]:font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";
  // TanStack marks a Link active (and forces aria-current="page") when its
  // search is a subset of the URL's; `undefined` keys would otherwise match any
  // value, lighting ALL and Reset alongside the chosen category.
  const exactSearch = { exact: true, includeSearch: true, explicitUndefined: true } as const;

  return (
    <div className="blog-index-toolbar grid gap-3 border-y border-[var(--blog-hairline)] px-6 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center xl:px-12">
      <nav
        aria-label={t.blogFilterCategory}
        data-blog-controls="category"
        className="min-w-0 lg:col-start-1 lg:row-start-1"
      >
        <ul className="flex min-w-0 gap-6 scroll-px-1 overflow-x-auto whitespace-nowrap px-1 py-1 lg:justify-start">
          <li className="shrink-0">
            <Link
              to={blogIndexPath(lang)}
              search={{ category: undefined, sort, q }}
              activeOptions={exactSearch}
              aria-current={category === undefined ? "page" : undefined}
              data-blog-category-link="all"
              className={categoryLinkClass}
            >
              {t.blogCategoryAll}
            </Link>
          </li>
          {categories.map((candidate) => (
            <li key={candidate} className="shrink-0">
              <Link
                to={blogIndexPath(lang)}
                search={{ category: candidate, sort, q }}
                activeOptions={exactSearch}
                aria-current={category === candidate ? "page" : undefined}
                data-blog-category-link={candidate}
                className={categoryLinkClass}
              >
                {t[categoryLabelKey(candidate)]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 items-center justify-end gap-2 lg:col-start-2 lg:row-start-1">
        <BlogSearchDialog lang={lang} posts={posts} category={category} sort={sort} q={q} />
        {filtering ? (
          <Link
            to={blogIndexPath(lang)}
            search={{ category: undefined, sort: undefined, q: undefined }}
            activeOptions={exactSearch}
            data-blog-reset
            className={`${buttonVariants({ color: "outline" })} min-h-[var(--lore-size-touch)] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]`}
          >
            {t.blogReset}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
