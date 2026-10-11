import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { AdjacentPosts } from "../model/adjacent-posts";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";
import { BlogCover } from "./blog-cover";

interface BlogClosingProps {
  readonly locale: string;
  readonly adjacent: AdjacentPosts;
}

/**
 * The article's closing block: the pair of neighbours in the same language as
 * cover cards. It renders nothing when the post has no neighbours.
 *
 * A missing neighbour leaves no empty list item behind, and no neighbour at all
 * leaves no footer. The labels name time ("earlier",
 * "newer") rather than list position, because the index is ordered by date and
 * "previous"/"next" would ambiguously mean either. The earlier card sits in the
 * left column and the newer one in the right, and they keep those columns when
 * only one exists, so the arrow and the side agree. The evidence sources are not
 * repeated here: they belong to the article body, beside the claims they
 * support.
 *
 * Each card reuses the index's cover (`BlogCover`, which also generates art for
 * a post without one) and its single-link idiom: the title link stretches over
 * the card, so it is the only interactive element.
 */
export function BlogClosing({ locale, adjacent }: BlogClosingProps) {
  const t = getStrings(locale);
  const { previous, next } = adjacent;
  const rows: { label: string; entry: BlogIndexEntry; newer: boolean }[] = [];
  if (previous !== undefined) {
    rows.push({ label: t.blogEarlierPost, entry: previous, newer: false });
  }
  if (next !== undefined) {
    rows.push({ label: t.blogNewerPost, entry: next, newer: true });
  }

  // Without neighbours there is nothing to close with, so no empty footer.
  if (rows.length === 0) return null;

  return (
    <footer className="blog-post__closing mt-16 border-t border-[var(--blog-hairline)] pt-10">
      <nav aria-label={t.navBlog}>
        <ul className="grid gap-6 sm:grid-cols-2">
          {rows.map((row) => (
            <li
              key={row.entry.slug}
              className={`blog-card relative flex min-w-0 flex-col border border-[var(--blog-hairline)] transition-colors duration-200 hover:bg-[var(--blog-quiet-surface)] focus-within:bg-[var(--blog-quiet-surface)] ${
                row.newer ? "sm:col-start-2" : "sm:col-start-1"
              }`}
            >
              <div className="blog-card-cover aspect-[16/9] w-full bg-[var(--lore-brand-deep)]">
                <BlogCover entry={row.entry} className="h-full w-full object-cover" />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <p className="flex items-center gap-1.5 text-sm text-fd-muted-foreground">
                  {row.newer ? null : <ArrowLeft aria-hidden="true" className="size-3.5" />}
                  {row.label}
                  {row.newer ? <ArrowRight aria-hidden="true" className="size-3.5" /> : null}
                </p>
                <p lang={row.entry.locale} className="mt-2 text-lg font-semibold leading-snug">
                  <Link
                    to={blogPostPath(row.entry.locale, row.entry.slug)}
                    hrefLang={row.entry.locale}
                    className="blog-title-link rounded-sm after:absolute after:inset-0"
                  >
                    {row.entry.data.title}
                  </Link>
                </p>
                <time
                  dateTime={row.entry.data.date}
                  className="mt-3 text-sm tabular-nums text-fd-muted-foreground"
                >
                  {row.entry.data.date}
                </time>
              </div>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
