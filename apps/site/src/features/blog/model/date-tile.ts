/**
 * Display parts for the index's date tile.
 *
 * The record date stays ISO in `dateTime`; these parts only decide how it is
 * shown. Locale tags are fixed (not the runtime default) and the date is built
 * in UTC, so Bun's server render and every browser produce the same text and
 * the tile never moves a day with the reader's timezone.
 */
export interface DateTileParts {
  readonly day: string;
  readonly month: string;
  readonly year: string;
}

const LOCALE_TAGS: Readonly<Record<string, string>> = { en: "en-US", zh: "zh-CN" };

export function dateTileParts(date: string, lang: string): DateTileParts {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  const tag = LOCALE_TAGS[lang] ?? "en-US";
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { ...options, timeZone: "UTC" }).format(instant);
  return {
    day: String(day).padStart(2, "0"),
    month: part({ month: "short" }),
    year: part({ year: "numeric" }),
  };
}
