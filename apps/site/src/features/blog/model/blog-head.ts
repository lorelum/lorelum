import { i18n } from "@/shared/i18n/config";
import { siteUrl } from "@/shared/config/site";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogPostData } from "../server/load-blog-post";

/**
 * Per-route `<head>` factories for the blog surface, shared by the
 * unprefixed default-language routes and the `/$lang` routes so the two never
 * drift. Canonical URLs always point at the unprefixed path for the default
 * language, mirroring the landing convention.
 */

interface HeadBlock {
  meta: Record<string, string>[];
  links: Array<{ rel: string; href: string }>;
}

const ogLocales: Record<string, string> = {
  en: "en_US",
  zh: "zh_CN",
};

function blogBase(lang: string): string {
  return lang === i18n.defaultLanguage ? "/blog" : `/${lang}/blog`;
}

export function blogIndexHead(lang: string): HeadBlock {
  const t = getStrings(lang);
  const canonical = `${siteUrl}${blogBase(lang)}`;

  return {
    meta: [
      { title: `${t.navBlog} | Lorelum` },
      { name: "description", content: t.blogIndexDescription },
      { property: "og:title", content: `${t.navBlog} | Lorelum` },
      { property: "og:description", content: t.blogIndexDescription },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:locale", content: ogLocales[lang] ?? ogLocales[i18n.defaultLanguage] },
    ],
    links: [{ rel: "canonical", href: canonical }],
  };
}

export function blogPostHead(lang: string, post: BlogPostData | undefined): HeadBlock {
  if (!post) {
    return { meta: [{ title: `Blog | Lorelum` }], links: [] };
  }

  const canonical = `${siteUrl}${blogBase(lang)}/${post.slug}`;

  return {
    meta: [
      { title: `${post.data.title} | Lorelum` },
      { name: "description", content: post.data.description },
      { property: "og:title", content: post.data.title },
      { property: "og:description", content: post.data.description },
      { property: "og:type", content: "article" },
      { property: "og:url", content: canonical },
      {
        property: "og:locale",
        content: ogLocales[lang] ?? ogLocales[i18n.defaultLanguage],
      },
      { property: "article:published_time", content: post.data.date },
    ],
    links: [{ rel: "canonical", href: canonical }],
  };
}
