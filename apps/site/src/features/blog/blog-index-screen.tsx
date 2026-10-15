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

/** Lead feature followed by magazine-layout cards, using authored frontmatter. */
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
