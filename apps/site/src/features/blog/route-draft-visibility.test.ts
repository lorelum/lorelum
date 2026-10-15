import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { offeredCategories } from "./model/sidebar-categories";

const page = (
  slug: string,
  locale: string,
  draft: boolean,
  date = "2026-09-18",
  category: "benchmark" | "packs" = "benchmark",
) => ({
  slugs: [slug],
  path: `content/blog/${slug}.mdx`,
  locale,
  url: locale === "en" ? `/blog/${slug}` : `/${locale}/blog/${slug}`,
  data: {
    title: `Title of ${slug}`,
    description: `Description of ${slug}.`,
    date,
    category,
    author: "Someone",
    draft,
  },
});
let pages = ["en", "zh"].flatMap((locale) => [
  page("practice-notes", locale, false),
  page("unfinished-notes", locale, true),
]);
const source = {
  getPages: () => pages,
  getPage: (slugs: readonly string[], lang = "en") =>
    pages.find(
      (candidate) => candidate.slugs.join("/") === slugs.join("/") && candidate.locale === lang,
    ),
};
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const originalDev = process.env.DEV;
const setDev = (development: boolean) => {
  if (development) process.env.DEV = "1";
  else delete process.env.DEV;
};
setDev(false);
// One fixture owns all module substitutions; server and route tests share it.
mock.module(here("./server/source.ts"), () => ({ blogSource: source }));
mock.module(here("./content/registry.ts"), () => ({
  blog: { toFumadocsSource: () => ({ files: () => [], ...source }) },
}));
mock.module(here("./content/client.ts"), () => ({
  loadBlogContent: async () => ({ default: () => null, toc: [] }),
  preloadBlogContent: async () => undefined,
}));
mock.module(here("../docs/server/source.ts"), () => ({
  source: { getPages: () => [{ url: "/docs", data: {} }] },
  getLLMText: async () => "",
}));

// Imports must follow mock registration: static imports would load the real MDX registry first.
const { loadBlogPost } = await import("./server/load-blog-post");
const { listBlogIndex, listBlogPosts } = await import("./server/list-blog-posts");
const { getPublishedBlogPages } = await import("./server/published-pages");
interface ArticleRoute {
  options: { loader: (input: { params: Record<string, string> }) => Promise<unknown> };
}
// Start's generated loader context is wider than the params consumed by these routes.
const enModule = (await import(pathToFileURL(here("../../routes/blog/$slug.tsx")).href)) as {
  Route: ArticleRoute;
};
const langModule = (await import(
  pathToFileURL(here("../../routes/$lang/blog/$slug.tsx")).href
)) as { Route: ArticleRoute };
const sitemapModule = (await import(pathToFileURL(here("../../routes/sitemap[.]xml.ts")).href)) as {
  Route: { options: { server: { handlers: { GET: () => Promise<Response> } } } };
};
// TanStack exposes this request storage through a global symbol, not a typed public export.
const globals = globalThis as Record<PropertyKey, unknown>;
const storage = globals[Symbol.for("tanstack-start:start-storage-context")] as {
  run: <T>(context: unknown, fn: () => T) => T;
};
const loadRoute = (route: ArticleRoute, params: Record<string, string>) =>
  storage.run(
    { request: new Request("http://localhost/blog/x"), response: new Response(), router: {} },
    () => route.options.loader({ params }),
  );
beforeEach(() => {
  pages = ["en", "zh"].flatMap((locale) => [
    page("practice-notes", locale, false),
    page("unfinished-notes", locale, true),
  ]);
  setDev(false);
});
afterAll(() => {
  if (originalDev === undefined) delete process.env.DEV;
  else process.env.DEV = originalDev;
});

describe("server-visible blog data", () => {
  test("draft URLs and both indexes agree in development and production; sitemap never previews", () => {
    for (const development of [false, true]) {
      setDev(development);
      for (const lang of ["en", "zh"]) {
        expect(loadBlogPost({ slug: "unfinished-notes", lang })?.slug).toBe(
          development ? "unfinished-notes" : undefined,
        );
        expect(listBlogPosts(lang).map((entry) => entry.slug)).toEqual(
          development ? ["practice-notes", "unfinished-notes"] : ["practice-notes"],
        );
        expect(loadBlogPost({ slug: "practice-notes", lang })?.slug).toBe("practice-notes");
      }
      expect(getPublishedBlogPages().map((entry) => entry.url)).toEqual([
        "/blog/practice-notes",
        "/zh/blog/practice-notes",
      ]);
    }
  });
  test("lists older and other-language posts with URLs pointing to the language that exists", () => {
    pages = [page("notes", "en", false, "2026-01-05"), page("zhongwen-bijiao", "zh", false)];
    for (const lang of ["en", "zh"]) {
      expect(listBlogPosts(lang).map(({ slug, locale }) => ({ slug, locale }))).toEqual([
        { slug: "zhongwen-bijiao", locale: "zh" },
        { slug: "notes", locale: "en" },
      ]);
    }
  });
  test("keeps navigation categories while filtering cards", () => {
    pages = [
      page("benchmark-notes", "en", false),
      page("pack-notes", "en", false, "2026-09-18", "packs"),
    ];
    const index = listBlogIndex("en", "benchmark");
    expect(index.posts.map((entry) => entry.slug)).toEqual(["benchmark-notes", "pack-notes"]);
    expect(index.filteredPostSlugs).toEqual(["benchmark-notes"]);
    expect(offeredCategories(index.posts)).toEqual(["benchmark", "packs"]);
    expect(listBlogPosts("en", "benchmark").map((entry) => entry.slug)).toEqual([
      "benchmark-notes",
    ]);
  });
  test("offers a draft translation only while developing, in either direction", () => {
    for (const [published, drafted] of [
      ["en", "zh"],
      ["zh", "en"],
    ] as const) {
      pages = [page("two-locales", published, false), page("two-locales", drafted, true)];
      setDev(false);
      expect(
        loadBlogPost({ slug: "two-locales", lang: published })?.alternateLocale,
      ).toBeUndefined();
      setDev(true);
      expect(loadBlogPost({ slug: "two-locales", lang: published })?.alternateLocale).toBe(drafted);
    }
  });
});

describe("article URL refusal", () => {
  // Uncompiled Start functions discard successful payloads; only notFound is observable here.
  for (const [name, route, params] of [
    ["unprefixed", enModule.Route, {}],
    ["Chinese", langModule.Route, { lang: "zh" }],
    ["English-prefixed", langModule.Route, { lang: "en" }],
  ] as const) {
    for (const slug of ["unfinished-notes", "no-such-post"]) {
      test(`${name} returns notFound for ${slug}`, async () => {
        await expect(loadRoute(route, { ...params, slug })).rejects.toMatchObject({
          isNotFound: true,
        });
      });
    }
  }
  test("rejects an unsupported locale", async () => {
    await expect(
      loadRoute(langModule.Route, { lang: "de", slug: "practice-notes" }),
    ).rejects.toMatchObject({ isNotFound: true });
  });
});

describe("crawler-visible sitemap", () => {
  for (const development of [false, true]) {
    test(`only lists published URLs in ${development ? "development" : "production"}`, async () => {
      setDev(development);
      const response = await sitemapModule.Route.options.server.handlers.GET();
      const body = await response.text();
      const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      expect(response.status).toBe(200);
      for (const prefix of ["", "/zh"]) {
        expect(locations).toContain(`https://lorelum.com${prefix}/blog`);
        expect(locations).toContain(`https://lorelum.com${prefix}/blog/practice-notes`);
      }
      expect(body).not.toContain("unfinished-notes");
    });
  }
});
