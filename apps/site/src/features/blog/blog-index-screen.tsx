import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "./content/frontmatter";
import type { BlogSort } from "./model/sort-posts";
import type { BlogIndexEntry } from "./model/list-posts";
import { BlogEntryRow } from "./components/blog-entry-row";
import { BlogIndexControls } from "./components/blog-index-controls";
import { BlogShell } from "./components/blog-shell";
import { BlogSidebar } from "./components/blog-sidebar";
import { BlogSurface } from "./components/blog-surface";
import "./styles/blog.css";

interface BlogIndexScreenProps {
  readonly lang: string;
  /** All visible posts, ordered by the selected sort. */
  readonly posts: readonly BlogIndexEntry[];
  /** Matching card slugs; omitted when no category is active. */
  readonly filteredPostSlugs?: readonly string[];
  /** The active category filter, as validated from the search param. */
  readonly category?: BlogCategory;
  /** The active ordering, as validated from the search param. */
  readonly sort: BlogSort;
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
export function BlogIndexScreen({
  lang,
  posts,
  filteredPostSlugs,
  category,
  sort,
}: BlogIndexScreenProps) {
  const t = getStrings(lang);
  const cardSlugs =
    filteredPostSlugs === undefined ? undefined : new Set(filteredPostSlugs);
  const cardPosts =
    cardSlugs === undefined ? posts : posts.filter((entry) => cardSlugs.has(entry.slug));

  return (
    <BlogSurface lang={lang}>
      <BlogShell
        sidebar={
          <BlogSidebar lang={lang} posts={posts} category={category} sort={sort} />
        }
      >
        {/* The entries are bounded panels, so they span the column; the reading
            measure belongs to prose, and the card's own padding keeps the text at a
            comfortable width without capping the panel. */}
        <div className="w-full">
          {/* A masthead at headline scale, not a form label: the index is an
              editorial surface, and while it is short a page-sized title reads
              as a first issue rather than as an empty page. The dek is gone by
              review — on a production index the sentence read as scaffolding.
              Rhythm follows the spacing roles — panel below the header, block
              once the viewport has room. */}
          <header className="mb-8 md:mb-10">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-fd-foreground sm:text-5xl">
              {t.navBlog}
            </h1>
          </header>

          <div className="lg:hidden">
            <BlogIndexControls lang={lang} posts={posts} category={category} sort={sort} />
          </div>

          {cardPosts.length === 0 ? (
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
            <ul className="mt-6 space-y-4">
              {cardPosts.map((entry) => (
                <BlogEntryRow key={`${entry.slug}-${entry.locale}`} entry={entry} lang={lang} />
              ))}
            </ul>
          )}
        </div>
      </BlogShell>
    </BlogSurface>
  );
}
