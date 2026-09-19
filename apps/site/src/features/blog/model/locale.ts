import { i18n } from "@/shared/i18n/config";

/**
 * Locale guard for the `/$lang/blog` routes. The landing routes tolerate
 * unknown locales, but the blog content index can only merge files for real
 * locales, so anything else is a 404.
 */
export function isSupportedBlogLocale(lang: string): boolean {
  return (i18n.languages as readonly string[]).includes(lang);
}
