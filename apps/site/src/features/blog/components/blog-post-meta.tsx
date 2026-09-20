import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogFrontmatter } from "../content/frontmatter";
import { blogIndexPath } from "../model/blog-routes";
import { BlogLanguageEntry } from "./blog-language-entry";
import { CategoryChip } from "./category-chip";

interface BlogPostMetaProps {
  readonly slug: string;
  readonly locale: string;
  readonly alternateLocale?: string;
  readonly data: BlogFrontmatter;
}

/**
 * The article's metadata line.
 *
 * Inline rather than a right-hand icon rail: the rail already holds the table
 * of contents, and a second column of metadata would squeeze the measure at
 * exactly the breakpoint where space is tightest. These are facts about the
 * post, not navigation.
 *
 * Order: published, `updated` only when the author recorded one, author,
 * category, the translation entry, then the page action pushed to the far end.
 * An absent `updated` is omitted entirely — a synthesised one would claim a
 * provenance signal this design exists to make trustworthy.
 */
export function BlogPostMeta({
  slug,
  locale,
  alternateLocale,
  data,
}: BlogPostMetaProps) {
  const t = getStrings(locale);

  return (
    <div className="blog-post__meta mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--blog-hairline)] pb-5 text-sm text-fd-muted-foreground">
      <time dateTime={data.date} className="tabular-nums">
        {data.date}
      </time>

      {data.updated === undefined ? null : (
        <span className="tabular-nums">
          {t.blogUpdatedOn} <time dateTime={data.updated}>{data.updated}</time>
        </span>
      )}

      <span aria-hidden="true" className="h-3.5 w-px bg-[var(--blog-hairline)]" />
      <span>{data.author}</span>

      <span aria-hidden="true" className="h-3.5 w-px bg-[var(--blog-hairline)]" />
      <CategoryChip lang={locale} category={data.category} pill />

      {alternateLocale === undefined ? null : (
        <BlogLanguageEntry slug={slug} locale={locale} alternateLocale={alternateLocale} />
      )}

      <Link
        to={blogIndexPath(locale)}
        activeOptions={{ exact: true }}
        className="blog-nav-link ms-auto inline-flex items-center gap-1.5"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        {t.navBlog}
      </Link>
    </div>
  );
}
