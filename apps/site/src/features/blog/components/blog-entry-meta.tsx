import { getStrings } from "@/shared/i18n/legacy-translations";
import { categoryLabelKey } from "../model/category-label";
import { dateTileParts } from "../model/date-tile";
import { languageHintKey } from "../model/entry-meta";
import type { BlogIndexEntry } from "../model/list-posts";

interface BlogEntryMetaProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
}

/** Compact semantic metadata; wraps naturally rather than clipping labels. */
export function BlogEntryMeta({ entry, lang }: BlogEntryMetaProps) {
  const t = getStrings(lang);
  const hintKey = languageHintKey(entry.locale, lang);
  const { day, month, year } = dateTileParts(entry.data.date, lang);

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-relaxed text-fd-muted-foreground">
      <span data-blog-category={entry.data.category} className="font-medium text-fd-foreground">
        {t[categoryLabelKey(entry.data.category)]}
      </span>
      <span aria-hidden="true">·</span>
      <span>{entry.data.author}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={entry.data.date} className="tabular-nums">
        {lang === "zh" ? `${year} ${month}${day}日` : `${month} ${day}, ${year}`}
      </time>
      {hintKey === undefined ? null : <span>{t[hintKey]}</span>}
    </p>
  );
}
