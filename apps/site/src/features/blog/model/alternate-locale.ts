/**
 * Which other locale a post has a translation in, if any.
 *
 * Kept pure so the decision is testable without Fumadocs' source index: the
 * caller supplies the locales and the existence test, the module owns the rule
 * that a language entry only appears for a translation that actually exists.
 * A pill that promises a translation the route cannot serve is worse than no
 * pill — Fumadocs rewrites the locale prefix unconditionally, so the reader
 * lands on a 404 instead of the page they were reading.
 */
export function pickAlternateLocale(
  locale: string,
  languages: readonly string[],
  exists: (candidate: string) => boolean,
): string | undefined {
  return languages.find((candidate) => candidate !== locale && exists(candidate));
}
