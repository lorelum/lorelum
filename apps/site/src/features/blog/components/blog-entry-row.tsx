import { Link } from "@tanstack/react-router";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { languageHintKey } from "../model/entry-meta";
import { blogPostPath } from "../model/blog-routes";
import type { BlogIndexEntry } from "../model/list-posts";
import { BlogMeta } from "./blog-meta";

interface BlogEntryRowProps {
  readonly entry: BlogIndexEntry;
  readonly lang: string;
}

/**
 * One row of the index.
 *
 * A row in a sequence is not a card: no surface, no radius, no shadow, and no
 * hover on the row itself — the title link is the only interactive element.
 * Order is title, language hint, metadata, summary, so the title reads as the
 * scan anchor rather than as an eyebrow sitting on top of the metadata.
 *
 * The link targets the entry's own locale: the index merges both locales, so an
 * entry can be listed on a page whose language it was never written in, and a
 * page-locale href would 404.
 */
export function BlogEntryRow({ entry, lang }: BlogEntryRowProps) {
  const t = getStrings(lang);
  const hintKey = languageHintKey(entry.locale, lang);

  return (
    <li className="py-8 first:pt-0">
      <h2 lang={entry.locale} className="text-xl font-medium leading-snug">
        <Link
          to={blogPostPath(entry.locale, entry.slug)}
          hrefLang={entry.locale}
          className="blog-title-link rounded-sm"
        >
          {entry.data.title}
        </Link>
      </h2>

      {hintKey ? <p className="mt-1 text-sm text-fd-muted-foreground">{t[hintKey]}</p> : null}

      <BlogMeta
        lang={lang}
        category={entry.data.category}
        date={entry.data.date}
        className="mt-3"
      />

      <p lang={entry.locale} className="mt-2 leading-relaxed text-fd-muted-foreground">
        {entry.data.description}
      </p>
    </li>
  );
}
