import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { AdjacentPosts } from "../model/adjacent-posts";
import { blogIndexPath, blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";

interface BlogClosingProps {
  readonly locale: string;
  readonly adjacent: AdjacentPosts;
}

/**
 * The article's closing block: the way back to the index and the pair of
 * neighbours in the same language.
 *
 * It always renders, so the end of an article is never a dead end even when the
 * post is the only one — only the neighbour rows are conditional, and a missing
 * neighbour leaves no empty list item behind. The labels name time ("earlier",
 * "newer") rather than list position, because the index is ordered by date and
 * "previous"/"next" would ambiguously mean either. The evidence sources are not
 * repeated here: they belong to the article body, beside the claims they
 * support.
 */
export function BlogClosing({ locale, adjacent }: BlogClosingProps) {
  const t = getStrings(locale);
  const { previous, next } = adjacent;
  const rows: { label: string; entry: BlogIndexEntry; alignEnd: boolean }[] = [];
  if (previous !== undefined) {
    rows.push({ label: t.blogEarlierPost, entry: previous, alignEnd: false });
  }
  if (next !== undefined) {
    rows.push({ label: t.blogNewerPost, entry: next, alignEnd: true });
  }

  return (
    <footer className="blog-post__closing mt-16 border-t border-[var(--blog-hairline)] pt-6">
      {rows.length === 0 ? null : (
        <nav aria-label={t.navBlog}>
          <ul className="flex flex-wrap justify-between gap-x-8 gap-y-3 text-sm">
            {rows.map((row) => (
              <li key={row.entry.slug} className={row.alignEnd ? "min-w-0 text-end" : "min-w-0"}>
                <Link
                  to={blogPostPath(row.entry.locale, row.entry.slug)}
                  className="blog-nav-link inline-flex flex-col gap-0.5"
                >
                  <span className="text-fd-muted-foreground">{row.label}</span>
                  <span className="font-medium">{row.entry.data.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p className="mt-6">
        <Link
          to={blogIndexPath(locale)}
          activeOptions={{ exact: true }}
          className="blog-nav-link inline-flex items-center gap-1.5"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t.navBlog}
        </Link>
      </p>
    </footer>
  );
}
