/**
 * Whether a post may be served at its own URL.
 *
 * A draft is a post the author has not published yet. In development it is
 * visible so the author can read the rendered page; everywhere else it does not
 * exist, even for a reader who knows the slug. The sitemap never lists one in
 * any environment — a sitemap is a list of what should be indexed, and a draft
 * is by definition not.
 *
 * The decision is pure so the two callers can share one rule and be tested
 * without a filesystem or a build.
 */
export interface PostVisibility {
  readonly draft: boolean;
  readonly isDevelopment: boolean;
}

export function isPostVisible({ draft, isDevelopment }: PostVisibility): boolean {
  return isDevelopment || !draft;
}
