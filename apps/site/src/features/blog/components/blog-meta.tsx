import type { BlogCategory } from "../content/frontmatter";
import { CategoryChip } from "./category-chip";

interface BlogMetaProps {
  readonly lang: string;
  readonly category: BlogCategory;
  /** The run date, as frontmatter states it (`YYYY-MM-DD`). */
  readonly date: string;
  readonly className?: string;
}

/**
 * One entry's metadata line.
 *
 * The date stays in its frontmatter form on purpose: it is a benchmark run
 * record the reader may want to match against the evidence, it reads the same
 * in every locale, and it needs no timezone decision. The category beside it is
 * the entry point into that category's view of the index.
 */
export function BlogMeta({ lang, category, date, className }: BlogMetaProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fd-muted-foreground ${
        className ?? ""
      }`}
    >
      <time dateTime={date} className="tabular-nums">
        {date}
      </time>
      <span aria-hidden="true" className="h-3.5 w-px bg-[var(--blog-hairline)]" />
      <CategoryChip lang={lang} category={category} />
    </div>
  );
}
