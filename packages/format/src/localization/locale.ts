/**
 * Canonical locale validation delegated to the runtime's ICU implementation.
 * This keeps the authoring contract small while covering the Unicode locale
 * identifiers supported by `Intl` without maintaining locale-data tables.
 */
function canonicalizeLocale(locale: string): string {
  if (typeof locale !== "string" || locale.length === 0) {
    throw new RangeError("locale must be a non-empty BCP 47 tag");
  }
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0];
    if (canonical === undefined) throw new RangeError("locale is not a BCP 47 tag");
    return canonical;
  } catch {
    throw new RangeError(`invalid BCP 47 locale: ${locale}`);
  }
}

/** True only when `locale` is valid BCP 47 and already canonically cased. */
export function validateLocalizationLocale(locale: string): boolean {
  try {
    return canonicalizeLocale(locale) === locale;
  } catch {
    return false;
  }
}
