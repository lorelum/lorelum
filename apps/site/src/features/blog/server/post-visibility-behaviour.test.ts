import { afterEach, describe, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

/**
 * The behaviour behind the visibility rule: the answer a reader gets, rather than
 * the way the call site is spelled.
 *
 * `post-visibility-wiring.test.ts` guards the source text of these three call
 * sites. Two review rounds measured what that class of guard can and cannot do: it
 * accepted a gate whose condition never fires, a draft check moved into another
 * module, and a spread that overrides the argument, while rejecting
 * behaviour-neutral rewrites. This file drives the same three functions through a
 * substituted source adapter instead, which needs no DOM and no new dependency —
 * they are server logic plus one adapter, and no component is involved.
 *
 * The fixtures vary every field a rule could key on: both locales, draft and
 * published, two publish dates, and a slug shorter than the others, and the slugs
 * are not shaped like the word "draft". A rule that hid only one locale, only
 * `draft-*` slugs, or only recent posts would otherwise pass. The environment:
 * `import.meta.env.DEV` is the expression the call sites read. A Vite build
 * substitutes it; under `bun test` it is a live view of `process.env`, so
 * `process.env.DEV` is what this file drives, and every test restores it.
 *
 * The boundary this does not reach is the routes, and `route-draft-visibility.test.ts`
 * is the file that now does: it substitutes the same adapter plus the registry and
 * the content client, drives the route modules' loaders inside TanStack Start's
 * storage context, and asserts the refusal there. The index route is still not
 * covered by it — that route's payload crosses a boundary that discards it — so its
 * visibility rests on this file's `listBlogPosts` assertions plus a text pin.
 *
 * `mock.module` is process-wide; this file and `route-draft-visibility.test.ts` are
 * the repository's two uses of it, and each substitutes the blog source adapter: a
 * test file that imported that adapter itself would see a fake rather than the real
 * source.
 */

interface FakePage {
  readonly slug: string;
  readonly slugs: readonly string[];
  readonly path: string;
  readonly locale: string;
  readonly data: Record<string, unknown>;
}

const page = (
  slug: string,
  locale: string,
  draft: boolean,
  { date = "2026-09-18" }: { date?: string } = {},
): FakePage => ({
  slug,
  slugs: [slug],
  path: `content/blog/${slug}.mdx`,
  locale,
  data: {
    title: `Title of ${slug}`,
    description: `Description of ${slug}.`,
    date,
    category: "benchmark",
    author: "Someone",
    draft,
  },
});

/** Short slug and early date, so neither "long slugs" nor "recent posts" is assumed. */
const shortOlder = () => page("notes", "en", false, { date: "2026-01-05" });
const longRecent = () => page("zhongwen-bijiao", "zh", false);

const pages: FakePage[] = [];
const setPages = (...next: FakePage[]) => {
  pages.length = 0;
  pages.push(...next);
};

mock.module(fileURLToPath(new URL("./source.ts", import.meta.url)), () => ({
  blogSource: {
    getPages: () => pages,
    getPage: (slugs: string[], lang?: string) =>
      pages.find(
        (candidate) =>
          candidate.slugs.join("/") === slugs.join("/") &&
          (lang === undefined || lang === candidate.locale),
      ),
  },
}));

const { loadBlogPost } = await import("./load-blog-post");
const { listBlogPosts } = await import("./list-blog-posts");
const { getPublishedBlogPages } = await import("./published-pages");

const setDev = (dev: boolean) => {
  if (dev) process.env.DEV = "1";
  else delete process.env.DEV;
};

afterEach(() => {
  setPages();
  setDev(false);
});

describe("post visibility, through the server functions a reader reaches", () => {
  test("outside development a draft exists nowhere, in either locale", () => {
    setPages(page("alpha-notes", "en", true), page("zhongwen-caogao", "zh", true));
    setDev(false);
    expect(loadBlogPost({ slug: "alpha-notes", lang: "en" })).toBeUndefined();
    expect(loadBlogPost({ slug: "zhongwen-caogao", lang: "zh" })).toBeUndefined();
    expect(listBlogPosts("en")).toHaveLength(0);
    expect(listBlogPosts("zh")).toHaveLength(0);
    expect(getPublishedBlogPages()).toHaveLength(0);
  });

  test("while developing each locale serves its own draft, and that locale's index agrees", () => {
    setPages(page("alpha-notes", "en", true));
    setDev(true);
    expect(loadBlogPost({ slug: "alpha-notes", lang: "en" })?.slug).toBe("alpha-notes");
    expect(listBlogPosts("en").map((entry) => entry.slug)).toEqual(["alpha-notes"]);

    setPages(page("zhongwen-caogao", "zh", true));
    expect(loadBlogPost({ slug: "zhongwen-caogao", lang: "zh" })?.slug).toBe("zhongwen-caogao");
    expect(listBlogPosts("zh").map((entry) => entry.slug)).toEqual(["zhongwen-caogao"]);
  });

  test("the sitemap never lists a draft, in either locale, not even while developing", () => {
    setPages(page("alpha-notes", "en", true), page("zhongwen-caogao", "zh", true));
    setDev(true);
    expect(getPublishedBlogPages()).toHaveLength(0);
  });

  test("every published post is served in both environments, whatever its date or slug length", () => {
    setPages(shortOlder(), longRecent());
    for (const dev of [false, true]) {
      setDev(dev);
      expect(loadBlogPost({ slug: "notes", lang: "en" })?.slug).toBe("notes");
      expect(loadBlogPost({ slug: "zhongwen-bijiao", lang: "zh" })?.slug).toBe(
        "zhongwen-bijiao",
      );
      // The sitemap is the list of what should be indexed: both posts, in both
      // environments, and neither the older one nor the shorter slug is special.
      expect(getPublishedBlogPages()).toHaveLength(2);
      // The index merges both locales, so each list holds both published slugs.
      for (const lang of ["en", "zh"]) {
        expect(listBlogPosts(lang).map((entry) => entry.slug).sort()).toEqual([
          "notes",
          "zhongwen-bijiao",
        ]);
      }
    }
  });

  test("each locale's production index is non-empty when that locale has a published post", () => {
    setPages(shortOlder(), longRecent());
    setDev(false);
    expect(listBlogPosts("en").map((entry) => entry.slug)).toContain("notes");
    expect(listBlogPosts("zh").map((entry) => entry.slug)).toContain("zhongwen-bijiao");
  });

  test("the translation entry is symmetric: a draft in either language is not offered", () => {
    // English published, Chinese drafted.
    setPages(page("two-locales", "en", false), page("two-locales", "zh", true));
    setDev(false);
    expect(loadBlogPost({ slug: "two-locales", lang: "en" })?.alternateLocale).toBeUndefined();
    setDev(true);
    expect(loadBlogPost({ slug: "two-locales", lang: "en" })?.alternateLocale).toBe("zh");

    // The other way round: Chinese published, English drafted.
    setPages(page("two-locales", "en", true), page("two-locales", "zh", false));
    setDev(false);
    expect(loadBlogPost({ slug: "two-locales", lang: "zh" })?.alternateLocale).toBeUndefined();
    setDev(true);
    expect(loadBlogPost({ slug: "two-locales", lang: "zh" })?.alternateLocale).toBe("en");
  });

  test("an entry that exists only in the other language is listed, and carries the language it exists in", () => {
    setPages(longRecent());
    setDev(false);
    const entries = listBlogPosts("en");
    expect(entries.map((entry) => entry.slug)).toEqual(["zhongwen-bijiao"]);
    // The row links with `blogPostPath(entry.locale, entry.slug)`, so the locale is
    // what a reader gets: the entry must go to the language that exists rather than
    // to the page's own (which is how the first Chinese-only post became a dead
    // link on the English index).
    expect(entries[0]?.locale).toBe("zh");
  });
});
