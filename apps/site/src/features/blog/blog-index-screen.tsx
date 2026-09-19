import { Link } from "@tanstack/react-router";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { LandingNavbar } from "@/features/landing/navigation/landing-navbar";
import { SiteFooter } from "@/components/landing/sections/site-footer";
import type { BlogIndexEntry } from "./model/list-posts";
import "./styles/blog.css";

interface BlogIndexScreenProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
}

/** Language marker shown when an entry only exists in the other locale. */
function translatedMarker(entry: BlogIndexEntry): string {
  return entry.locale === "zh" ? "中文" : "EN";
}

/**
 * Text-first blog index: a plain, deterministic list of posts. Summaries come
 * from each post's frontmatter description — one factual sentence, no hero
 * copy and no separate editorial teaser text.
 */
export function BlogIndexScreen({ lang, posts }: BlogIndexScreenProps) {
  const t = getStrings(lang);
  const base = lang === i18n.defaultLanguage ? "/blog" : `/${lang}/blog`;

  return (
    <div className="blog-page flex min-h-dvh flex-col">
      <LandingNavbar lang={lang} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-24">
        <h1 className="text-3xl font-semibold tracking-tight text-fd-foreground">{t.navBlog}</h1>

        {posts.length === 0 ? (
          <p className="mt-8 text-fd-muted-foreground">{t.blogEmpty}</p>
        ) : (
          <ul className="mt-8 divide-y divide-fd-border/60">
            {posts.map((entry) => {
              const href: string = `${base}/${entry.slug}`;
              return (
                <li key={`${entry.slug}-${entry.locale}`} className="blog-entry py-8">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fd-muted-foreground">
                    <time dateTime={entry.data.date}>{entry.data.date}</time>
                    <span aria-hidden="true" className="h-3.5 w-px bg-fd-border/60" />
                    <span>{entry.data.category}</span>
                    {entry.translated ? (
                      <>
                        <span aria-hidden="true" className="h-3.5 w-px bg-fd-border/60" />
                        <span lang={entry.locale}>{translatedMarker(entry)}</span>
                      </>
                    ) : null}
                  </div>

                  <h2 className="mt-3 text-xl font-medium leading-snug">
                    <Link
                      to={href}
                      className="rounded-sm text-fd-foreground transition-colors hover:text-fd-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                    >
                      {entry.data.title}
                    </Link>
                  </h2>

                  <p className="mt-2 leading-relaxed text-fd-muted-foreground">
                    {entry.data.description}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
