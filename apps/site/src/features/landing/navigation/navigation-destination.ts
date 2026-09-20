/**
 * Primary-navigation destinations, independent of how a URL spells them.
 *
 * The default locale has two working URL forms for the same page — `/blog` and
 * `/en/blog` both serve the blog index — and every locale-prefixed page has a
 * prefixed spelling. TanStack Router's own active check compares the link's href
 * with the current pathname, so it marks the entry current in one spelling and
 * not in the other; this mapping is what makes "which destination am I on"
 * independent of the spelling.
 */

export const navigationDestinations = ["home", "docs", "blog"] as const;

export type NavigationDestination = (typeof navigationDestinations)[number];

function segments(pathname: string): string[] {
  return pathname.split("/").filter((part) => part !== "");
}

/**
 * The destination a pathname belongs to, or `undefined` for anything the primary
 * navigation does not own (the API routes, the sitemap, an unknown path).
 *
 * A leading locale segment is dropped whenever it names a configured language —
 * the default language included, which is why this does not take a default
 * language: dropping only the non-default one would leave `/en/blog`
 * unrecognised, and that is exactly the spelling the prefixed routes serve.
 */
export function destinationOf(
  pathname: string,
  languages: readonly string[],
): NavigationDestination | undefined {
  const parts = segments(pathname);
  const [first, ...rest] = parts;
  const localised = first !== undefined && languages.includes(first);
  const path = localised ? rest : parts;
  const [head] = path;

  if (head === undefined) return "home";
  if (head === "docs") return "docs";
  if (head === "blog") return "blog";
  return undefined;
}

/**
 * The path a destination is served at in one locale.
 *
 * The default language stays unprefixed, so the primary navigation keeps one
 * canonical href per destination per locale.
 */
export function destinationPath(
  destination: NavigationDestination,
  language: string,
  defaultLanguage: string,
): string {
  const prefix = language === defaultLanguage ? "" : `/${language}`;
  return destination === "home" ? prefix || "/" : `${prefix}/${destination}`;
}
