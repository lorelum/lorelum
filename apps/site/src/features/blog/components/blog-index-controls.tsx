import { Link, useNavigate } from "@tanstack/react-router";
import { Select } from "@lorelum/ui";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import { categoryLabelKey } from "../model/category-label";
import type { BlogIndexEntry } from "../model/list-posts";
import { blogSorts, type BlogSort } from "../model/sort-posts";
import { offeredCategories } from "../model/sidebar-categories";
import { BlogSearchDialog } from "./blog-search-dialog";

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
  const categories = offeredCategories(posts);
  const filtering = category !== undefined || sort !== "newest" || q !== undefined;

  return (
    <div className="blog-index-toolbar grid gap-3 border-b border-[var(--blog-hairline)] px-6 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center xl:px-12">
      <div className="flex min-w-0 flex-wrap gap-2">
        <section aria-label={t.blogFilterCategory} data-blog-controls="category">
          <p className="sr-only">{t.blogFilterCategory}</p>
          <Select<BlogCategory | "all">
            id="blog-category"
            label={t.blogFilterCategory}
            value={category ?? "all"}
            valueLabel={category === undefined ? t.blogAllCategories : t[categoryLabelKey(category)]}
            options={[{ value: "all", label: t.blogAllCategories }, ...categories.map((candidate) => ({ value: candidate, label: t[categoryLabelKey(candidate)] }))]}
            onValueChange={(candidate) => {
              void navigate({ to: blogIndexPath(lang), search: { category: candidate === "all" ? undefined : candidate, sort, q } });
            }}
          />
        </section>
        <section aria-label={t.blogSortBy} data-blog-controls="sort">
          <p className="sr-only">{t.blogSortBy}</p>
          <Select<BlogSort>
            id="blog-sort"
            label={t.blogSortBy}
            value={sort}
            options={blogSorts.map((candidate) => ({ value: candidate, label: t[sortLabelKey[candidate]] }))}
            onValueChange={(candidate) => {
              void navigate({ to: blogIndexPath(lang), search: { category, sort: candidate, q } });
            }}
          />
        </section>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <BlogSearchDialog lang={lang} posts={posts} category={category} sort={sort} q={q} />
        {filtering ? (
          <Link
            to={blogIndexPath(lang)}
            search={{ category: undefined, sort: undefined, q: undefined }}
            activeOptions={{ exact: true, includeSearch: true }}
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
