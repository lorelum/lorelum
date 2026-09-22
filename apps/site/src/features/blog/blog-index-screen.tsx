import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "./content/frontmatter";
import { blogIndexPath } from "./model/blog-routes";
import { categoryLabelKey } from "./model/category-label";
import type { BlogIndexEntry } from "./model/list-posts";
import { BlogEntryRow } from "./components/blog-entry-row";
import { BlogShell } from "./components/blog-shell";
import { BlogSidebar } from "./components/blog-sidebar";
import { BlogSurface } from "./components/blog-surface";
import "./styles/blog.css";

interface BlogIndexScreenProps {
  readonly lang: string;
  /** Already filtered by the route when a category is active. */
  readonly posts: readonly BlogIndexEntry[];
  /** The active category filter, as validated from the search param. */
  readonly category?: BlogCategory;
}

/**
 * Text-first blog index: a plain, deterministic list of posts. Summaries come
 * from each post's frontmatter description — one factual sentence, no hero copy
 * and no separate editorial teaser text.
 *
 * The list itself still does no year grouping, pagination, series or related
 * posts while it is short: at n=1 those components would render nothing, and a
 * row gains its structure from the hairline between rows and its metadata, not
 * from the number of siblings. What the page gained instead is the shell around
 * it — the same left column and reading column the article page uses, so the two
 * screens are one surface rather than two layouts. The reading column keeps its
 * measure inside the shell; the shell is what spans the viewport.
 */
export function BlogIndexScreen({ lang, posts, category }: BlogIndexScreenProps) {
  const t = getStrings(lang);

  return (
    <BlogSurface lang={lang}>
      <BlogShell sidebar={<BlogSidebar lang={lang} posts={posts} category={category} />}>
        <div className="mx-auto w-full max-w-[var(--blog-measure)]">
          <header>
            <h1 className="text-3xl font-semibold tracking-tight text-fd-foreground">
              {t.navBlog}
            </h1>
            <p className="mt-3 text-fd-muted-foreground">{t.blogIndexDescription}</p>
          </header>

          {/*
           * The filter state only exists while a filter is active: an always-present
           * filter bar would be a control that occupies the page while doing
           * nothing, and at n=1 every one of its options returns the same list.
           * The sidebar's category section is the standing entry point instead.
           */}
          {category === undefined ? null : (
            <p className="mt-6 flex flex-wrap items-center gap-x-2 text-sm text-fd-muted-foreground">
              <span>{t.blogFilteredByPrefix}</span>
              <span className="font-medium text-fd-foreground">
                {t[categoryLabelKey(category)]}
              </span>
              <span aria-hidden="true">·</span>
              <Link to={blogIndexPath(lang)} className="blog-nav-link rounded-sm">
                {t.blogShowAll}
              </Link>
            </p>
          )}

          {posts.length === 0 ? (
            <p className="mt-8 text-fd-muted-foreground">
              {category === undefined ? t.blogEmpty : t.blogNoPostsInCategory}{" "}
              <Link
                to="/$lang/docs/$"
                params={{ lang, _splat: "" }}
                className="blog-nav-link rounded-sm"
              >
                {t.readDocs}
              </Link>
            </p>
          ) : (
            <ul className="blog-entry-list mt-8">
              {posts.map((entry) => (
                <BlogEntryRow key={`${entry.slug}-${entry.locale}`} entry={entry} lang={lang} />
              ))}
            </ul>
          )}
        </div>
      </BlogShell>
    </BlogSurface>
  );
}
