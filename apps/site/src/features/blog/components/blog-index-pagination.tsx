import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import type { BlogSort } from "../model/sort-posts";

interface BlogIndexPaginationProps {
  readonly lang: string;
  readonly page: number;
  readonly pageCount: number;
  readonly category?: BlogCategory;
  readonly sort: BlogSort;
  readonly q?: string;
}

const exactSearch = { exact: true, includeSearch: true, explicitUndefined: true } as const;

/** Constant-size navigation: endpoints, current page, and immediate neighbours. */
export function BlogIndexPagination({
  lang,
  page,
  pageCount,
  category,
  sort,
  q,
}: BlogIndexPaginationProps) {
  if (pageCount <= 1) return null;
  const t = getStrings(lang);
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((candidate) => candidate >= 1 && candidate <= pageCount)
    .sort((a, b) => a - b);
  const linkClass =
    "blog-nav-link inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-3 text-sm";

  return (
    <nav aria-label={t.blogPagination} className="mt-8 px-6 pb-8 xl:px-12">
      <ul className="flex flex-wrap items-center justify-center gap-1">
        {page > 1 ? (
          <li>
            <Link
              to={blogIndexPath(lang)}
              search={{ category, sort, q, page: page - 1 }}
              activeOptions={exactSearch}
              className={linkClass}
            >
              {t.blogPreviousPage}
            </Link>
          </li>
        ) : null}
        {pages.map((target, index) => (
          <li key={target} className="flex items-center gap-1">
            {index > 0 && target - pages[index - 1]! > 1 ? (
              <span aria-hidden="true" className="px-2 text-fd-muted-foreground">
                …
              </span>
            ) : null}
            <Link
              to={blogIndexPath(lang)}
              search={{ category, sort, q, page: target }}
              activeOptions={exactSearch}
              aria-label={t.blogPageLabel.replace("{page}", String(target))}
              aria-current={target === page ? "page" : undefined}
              className={linkClass}
            >
              {target}
            </Link>
          </li>
        ))}
        {page < pageCount ? (
          <li>
            <Link
              to={blogIndexPath(lang)}
              search={{ category, sort, q, page: page + 1 }}
              activeOptions={exactSearch}
              className={linkClass}
            >
              {t.blogNextPage}
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
