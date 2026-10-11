import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogCategory } from "./content/frontmatter";
import type { BlogSort } from "./model/sort-posts";
import type { BlogIndexEntry } from "./model/list-posts";
import { BlogIndexBlocks } from "./components/blog-index-blocks";
import { BlogIndexControls } from "./components/blog-index-controls";
import { BlogShell } from "./components/blog-shell";
import { BlogSurface } from "./components/blog-surface";
import { layoutIndex } from "./model/index-layout";
import "./styles/blog.css";

interface BlogIndexScreenProps {
  readonly lang: string;
  /** All visible posts, ordered by the selected sort. */
  readonly posts: readonly BlogIndexEntry[];
  /** Matching card slugs; omitted when no category or query is active. */
  readonly filteredPostSlugs?: readonly string[];
  /** The active category filter, as validated from the search param. */
  readonly category?: BlogCategory;
  /** The active ordering, as validated from the search param. */
  readonly sort: BlogSort;
  readonly q?: string;
}

/**
 * Editorial index: the first visible post fills the brand stage, and the rest
 * follow as bordered cards in a magazine layout (`layoutIndex`): two side
 * cards under the lead, then grid, band and split blocks in turn. Summaries come
 * from frontmatter, not invented teaser copy.
 *
 * The list itself still does no year grouping, pagination, series or related
 * posts while it is short: at n=1 those components would render nothing, and a
 * card gains its structure from its cover and metadata, not the number of
 * siblings. The index uses the shell's full width, while the article keeps its
 * navigation and reading measure. Discovery controls belong above this list.
 */
export function BlogIndexScreen({
  lang,
  posts,
  filteredPostSlugs,
  category,
  sort,
  q,
}: BlogIndexScreenProps) {
  const t = getStrings(lang);
  const cardSlugs = filteredPostSlugs === undefined ? undefined : new Set(filteredPostSlugs);
  const cardPosts =
    cardSlugs === undefined ? posts : posts.filter((entry) => cardSlugs.has(entry.slug));

  return (
    <BlogSurface lang={lang} index>
      <BlogShell index>
        <div className="w-full">
          <header className="px-6 pb-8 pt-12 text-center xl:px-12">
            <h1 className="text-[length:var(--lore-text-headline)] font-semibold leading-tight">
              {t.blogIndexTitle}
            </h1>
            <p className="mt-3 text-sm text-fd-muted-foreground">{t.blogIndexTagline}</p>
          </header>
          <BlogIndexControls lang={lang} posts={posts} category={category} sort={sort} q={q} />

          {q === undefined && category === undefined ? null : (
            <p
              role="status"
              aria-live="polite"
              className="mt-4 px-6 text-sm text-fd-muted-foreground xl:px-12"
            >
              {t.blogSearchResults.replace("{count}", String(cardPosts.length))}
            </p>
          )}

          {cardPosts.length === 0 ? (
            <p className="mt-8 px-6 text-fd-muted-foreground xl:px-12">
              {q !== undefined
                ? t.blogNoSearchResults
                : category === undefined
                  ? t.blogEmpty
                  : t.blogNoPostsInCategory}{" "}
              {q !== undefined ? null : (
                <Link
                  to="/$lang/docs/$"
                  params={{ lang, _splat: "" }}
                  className="blog-nav-link rounded-sm"
                >
                  {t.readDocs}
                </Link>
              )}
            </p>
          ) : (
            <BlogIndexBlocks blocks={layoutIndex(cardPosts)} lang={lang} />
          )}
        </div>
      </BlogShell>
    </BlogSurface>
  );
}
