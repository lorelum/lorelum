import { getStrings } from "@/shared/i18n/legacy-translations";
import { categoryLabelKey } from "../model/category-label";
import { dateTileParts } from "../model/date-tile";
import { languageHintKey } from "../model/entry-meta";
import type { BlogIndexEntry } from "../model/list-posts";

interface BlogEntryMetaProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
}

/**
 * An entry's metadata block: a date tile, then category, author and the
 * language hint. It sits above the title and never over the cover, whose
 * corners carry required labels.
 *
 * The tile is display only: `dateTime` keeps the ISO record date, and the
 * parts come from fixed locale tags in UTC (see `dateTileParts`). Text stays
 * sentence case with no tracking, so it is metadata rather than an eyebrow.
 */
export function BlogEntryMeta({ entry, lang }: BlogEntryMetaProps) {
  const t = getStrings(lang);
  const hintKey = languageHintKey(entry.locale, lang);
  const { day, month, year } = dateTileParts(entry.data.date, lang);

  return (
    <div className="flex items-center gap-4 text-sm text-fd-muted-foreground">
      <time
        dateTime={entry.data.date}
        className="flex w-16 shrink-0 flex-col items-center border border-[var(--blog-hairline)] py-2 tabular-nums leading-none"
      >
        <span className="text-2xl font-semibold text-fd-foreground">{day}</span>
        <span className="mt-1 text-xs">{month}</span>
        <span className="mt-0.5 text-xs">{year}</span>
      </time>
      <div className="min-w-0">
        <p>
          <span data-blog-category={entry.data.category} className="font-medium text-fd-foreground">
            {t[categoryLabelKey(entry.data.category)]}
          </span>
          <span> · {entry.data.author}</span>
        </p>
        {hintKey ? <p className="mt-1 text-xs">{t[hintKey]}</p> : null}
      </div>
    </div>
  );
}
