import { i18n } from "@/shared/i18n/config";

/**
 * Blog URL construction, in one place.
 *
 * The default language is unprefixed (`/blog`), every other locale is prefixed
 * (`/zh/blog`), mirroring the landing convention and the canonical URLs the
 * sitemap emits.
 */

/** Index path for a locale. */
export function blogIndexPath(lang: string): string {
  return lang === i18n.defaultLanguage ? "/blog" : `/${lang}/blog`;
}

/**
 * Post path for the **content's own** locale, not the page's.
 *
 * The index merges both locales' files, so an entry can be listed on a page
 * whose language it does not exist in. Building the href from the page's
 * language sent those readers to a slug that was never published in that
 * locale — a guaranteed 404.
 */
export function blogPostPath(locale: string, slug: string): string {
  return `${blogIndexPath(locale)}/${slug}`;
}
