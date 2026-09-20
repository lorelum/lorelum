import { Link } from "@tanstack/react-router";
import { Languages } from "lucide-react";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { blogPostPath } from "../model/blog-routes";

interface BlogLanguageEntryProps {
  readonly slug: string;
  /** The locale the reader is on; the label is written in it. */
  readonly locale: string;
  /** The other locale this post exists in. Only rendered for a real file. */
  readonly alternateLocale: string;
}

/**
 * The pill that offers the post's translation.
 *
 * The label is written in the reader's language ("Read in" / "阅读") and the
 * language name that follows is written in *its own* language, tagged with
 * `lang` so a screen reader switches voice for it. A dictionary template cannot
 * produce a whole sentence in the target language, so the structure is
 * "label + name" rather than a translated sentence.
 *
 * It is only rendered when the server found a file in the other locale, and it
 * links with that locale's own path: a locale-prefix toggle would send a reader
 * of an untranslated post to a 404.
 */
export function BlogLanguageEntry({ slug, locale, alternateLocale }: BlogLanguageEntryProps) {
  const t = getStrings(locale);
  const isDefault = alternateLocale === i18n.defaultLanguage;
  const name = isDefault ? t.blogLanguageEnglish : t.blogLanguageChinese;

  // No `aria-label`: the accessible name is the visible text, which already
  // reads correctly, and a label would override the naming. Measured in the
  // accessibility tree, `aria-label` became the link's name and the inner
  // `<span lang>` stopped contributing to it — the language name would then be
  // pronounced in the page's language, which is what the `lang` tag exists to
  // prevent. The visible text and the accessible name are the same string, so
  // voice control can still name the link by what it shows.
  return (
    <Link
      to={blogPostPath(alternateLocale, slug)}
      hrefLang={alternateLocale}
      className="blog-nav-link inline-flex items-center gap-1.5 rounded-full border border-[var(--input)] px-2.5 py-0.5"
    >
      <Languages aria-hidden="true" className="size-3.5" />
      {t.blogReadIn} <span lang={alternateLocale}>{name}</span>
    </Link>
  );
}
