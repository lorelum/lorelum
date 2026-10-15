import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogFrontmatter } from "../content/frontmatter";
import { CategoryChip } from "./category-chip";

interface BlogPostMetaProps {
  readonly locale: string;
  readonly data: BlogFrontmatter;
}

/** Authored publication facts; omit the update date when none was recorded. */
export function BlogPostMeta({ locale, data }: BlogPostMetaProps) {
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
    </div>
  );
}
