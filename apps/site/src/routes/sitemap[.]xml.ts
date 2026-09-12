import { createFileRoute } from "@tanstack/react-router";
import { source } from "@/features/docs/server/source";
import { i18n } from "@/shared/i18n/config";
import { siteUrl } from "@/shared/config/site";

const URLSET_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

/** XML-escape a string for use inside a `<loc>`/`<lastmod>` element. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the absolute canonical URL for a site-relative path, collapsing the
 * default-language prefix (`/en` → `/`) so the sitemap has one URL per page.
 */
function canonicalFor(path: string): string {
  const prefix = `/${i18n.defaultLanguage}`;
  // `path` is a leading-slash site path with the locale already resolved.
  if (path === prefix) return `${siteUrl}/`;
  if (path.startsWith(`${prefix}/`)) return `${siteUrl}${path.slice(prefix.length)}`;
  return `${siteUrl}${path}`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const pages = source.getPages();

        // Collect every documentation page (both locales) as an absolute URL.
        const urls = new Set<string>();
        for (const page of pages) {
          // `page.url` already carries the locale prefix (e.g. `/docs`,
          // `/zh/docs`). Collapse the default-language versions to their
          // unprefixed path so the sitemap has one canonical URL per page.
          urls.add(canonicalFor(page.url));
        }

        // Landing pages.
        urls.add(`${siteUrl}/`);
        for (const lang of i18n.languages) {
          if (lang === i18n.defaultLanguage) continue;
          urls.add(`${siteUrl}/${lang}`);
        }

        const today = new Date().toISOString().slice(0, 10);
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="${URLSET_NS}">
${[...urls]
  .sort()
  .map(
    (loc) => `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${today}</lastmod>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

        return new Response(body, {
          headers: { "content-type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
