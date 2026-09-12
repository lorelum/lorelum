import { i18n } from "@/shared/i18n/config";
import { siteUrl } from "@/shared/config/site";

/**
 * Site-wide SEO metadata for the marketing/landing surface, keyed by locale.
 *
 * The route `head` factories in `routes/$lang/index.tsx` and `routes/index.tsx`
 * read from here so the SSR `<title>`, `description` and OpenGraph tags render
 * in the page's own language instead of the previous English-only default.
 *
 * `siteUrl` is the canonical deploy origin used for absolute `canonical`,
 * `og:url` and the `robots.txt`/`sitemap.xml` Sitemap directive. It falls back
 * through the runtime-provided Cloudflare Pages URL and then the production
 * `https://lorelum.com` origin so the values stay valid without config; deploy a
 * different origin by setting `SITE_URL` (or `CF_PAGES_URL`) at build time.
 */

export { siteUrl } from "@/shared/config/site";

export interface LandingMeta {
  title: string;
  description: string;
  /** OpenGraph title; defaults to `title` when omitted. */
  ogTitle?: string;
  /** OpenGraph description; defaults to `description` when omitted. */
  ogDescription?: string;
  /** BCP-47 locale for `og:locale` (e.g. `en_US`, `zh_CN`). */
  ogLocale: string;
}

/** SEO metadata per supported locale. Locales without an entry fall back to
 *  the default language's entry via `getLandingMeta`. */
const landingMeta: Record<string, LandingMeta> = {
  en: {
    title: "Lorelum — the right Practice for the right task and moment",
    description:
      "Lorelum keeps your team\u2019s engineering Practices structured and retrievable, and injects the right one into your AI coding agent\u2019s context exactly when the task needs it.",
    ogLocale: "en_US",
  },
  zh: {
    title: "Lorelum —— 在正确的任务与关键时刻，检索正确的工程 Practice",
    description:
      "Lorelum 让团队的工程 Practice 保持结构化、可检索，并在任务最需要的那一刻，把正确的那条注入 AI 编码智能体的上下文。",
    ogLocale: "zh_CN",
  },
};

/** Resolve metadata for a locale, falling back to the default language. */
export function getLandingMeta(locale: string): LandingMeta {
  return landingMeta[locale] ?? landingMeta[i18n.defaultLanguage];
}

/**
 * Build the per-language `<head>` block for the landing routes.
 *
 * Shared by `routes/$lang/index.tsx` (localized path) and `routes/index.tsx`
 * (default-language `/`) so the two never drift. `lang` is the resolved locale;
 * the canonical URL points at the unprefixed root for the default language and
 * at the `/lang` path otherwise.
 */
export function landingHead(lang: string): {
  meta: Record<string, string>[];
  links: Array<{ rel: string; href: string }>;
} {
  const meta = getLandingMeta(lang);
  const isDefault = lang === i18n.defaultLanguage;
  const path = isDefault ? "/" : `/${lang}`;
  const canonical = `${siteUrl}${path === "/" ? "" : path}`;
  const title = meta.title;

  return {
    meta: [
      { title },
      { name: "description", content: meta.description },
      { property: "og:site_name", content: "Lorelum" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: meta.ogLocale },
      { property: "og:title", content: meta.ogTitle ?? title },
      {
        property: "og:description",
        content: meta.ogDescription ?? meta.description,
      },
      { property: "og:url", content: canonical },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: meta.ogTitle ?? title },
      {
        name: "twitter:description",
        content: meta.ogDescription ?? meta.description,
      },
    ],
    links: [{ rel: "canonical", href: canonical }],
  };
}
