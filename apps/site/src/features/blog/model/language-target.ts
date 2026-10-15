import { i18n } from "@/shared/i18n/config";
import { blogIndexPath, blogPostPath } from "./blog-routes";

interface ArticleLanguageTargetInput {
  /** The language the reader is in. */
  readonly lang: string;
  readonly slug: string;
  /** The other locale that publishes this post, when there is one (resolved by the loader). */
  readonly alternateLocale?: string;
}

/**
 * Where the navbar's language control sends a reader of an article.
 *
 * The shared control swaps the locale prefix of the current path and cannot know
 * whether the translation exists; on a drafted or missing one it would answer
 * 404, and the prerender crawl that followed such a link failed the whole build.
 * An article does know: its loader reports the other locale only when that post
 * is published. So the target is the translation when there is one, and
 * otherwise the other language's blog index, which always exists. The reader
 * always changes language and never lands on an error.
 */
export function articleLanguageTarget({
  lang,
  slug,
  alternateLocale,
}: ArticleLanguageTargetInput): string {
  if (alternateLocale !== undefined) return blogPostPath(alternateLocale, slug);
  const other = i18n.languages.find((candidate) => candidate !== lang) ?? i18n.defaultLanguage;
  return blogIndexPath(other);
}
