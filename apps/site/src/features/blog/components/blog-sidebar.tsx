import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";

/** The complete visible index in the article shell's left navigation column. */
interface BlogSidebarProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
}

export function BlogSidebar({ lang, posts }: BlogSidebarProps) {
  const t = getStrings(lang);

  return (
    <nav aria-label={t.navBlog} className="text-sm">
      <p className="text-xs font-medium tracking-wide text-fd-muted-foreground">{t.blogAllPosts}</p>
      <ul className="mt-3 space-y-1">
        {posts.map((entry) => (
          <li key={`${entry.slug}-${entry.locale}`}>
            <Link
              to={blogPostPath(entry.locale, entry.slug)}
              // Mark only this article, not a prefix-matching destination.
              activeOptions={{ exact: true }}
              className="blog-nav-link flex min-h-[var(--lore-size-touch)] items-center rounded-sm px-2 py-2 text-fd-muted-foreground"
            >
              {entry.data.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
