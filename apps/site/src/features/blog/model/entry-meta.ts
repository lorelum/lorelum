/**
 * The reader-facing hint shown when a listed entry's content language is not
 * the page's language.
 *
 * It answers the reader's actual question — "can I read this in my language?" —
 * rather than announcing that a translation exists somewhere. `lang` is
 * deliberately not applied to it: the hint is written in the *reader's*
 * language, while the title and summary it sits under carry the content's.
 */
export type LanguageHintKey = "blogOnlyInEnglish" | "blogOnlyInChinese";

/** Returns `undefined` when the content is already in the page's language. */
export function languageHintKey(
  contentLocale: string,
  pageLocale: string,
): LanguageHintKey | undefined {
  if (contentLocale === pageLocale) return undefined;
  return contentLocale === "zh" ? "blogOnlyInChinese" : "blogOnlyInEnglish";
}
