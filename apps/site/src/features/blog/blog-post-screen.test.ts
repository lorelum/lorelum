import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const postScreen = readFileSync(new URL("./blog-post-screen.tsx", import.meta.url), "utf8");
const meta = readFileSync(new URL("./components/blog-post-meta.tsx", import.meta.url), "utf8");
const closing = readFileSync(new URL("./components/blog-closing.tsx", import.meta.url), "utf8");
const languageEntry = readFileSync(
  new URL("./components/blog-language-entry.tsx", import.meta.url),
  "utf8",
);
const notFound = readFileSync(new URL("./components/blog-not-found.tsx", import.meta.url), "utf8");
const blogCss = readFileSync(new URL("./styles/blog.css", import.meta.url), "utf8");
const rules = blogCss.replace(/\/\*[\s\S]*?\*\//g, "");

const enRoute = readFileSync(new URL("../../routes/blog/$slug.tsx", import.meta.url), "utf8");
const langRoute = readFileSync(
  new URL("../../routes/$lang/blog/$slug.tsx", import.meta.url),
  "utf8",
);

describe("article page structure", () => {
  test("tracks the table of contents by depth rather than listing every heading", () => {
    // `rehypeToc` collects h1-h6; an h4 would otherwise flood a rail sized for
    // the reading structure. The depth rule lives in the model and is tested
    // there; here the screen must actually use it.
    expect(postScreen).toContain("readingTocItems(useTOCItems())");
  });

  test("the rail's label is not a heading", () => {
    // A heading here would join the document outline on the same level as the
    // article's own h2s, and would also be caught by the display-face rule the
    // article headings use. The aside's accessible name carries the label.
    expect(postScreen).toMatch(/aria-label=\{t\.blogOnThisPage\}/);
    expect(postScreen).not.toMatch(/<h[1-6][^>]*>\s*\{t\.blogOnThisPage\}/);
  });

  test("no decorative icon precedes the contents label", () => {
    expect(postScreen).not.toContain("lucide-react");
    expect(postScreen).not.toContain("<Text ");
  });

  test("narrow viewports get a native disclosure, and it is honest about what it is", () => {
    // `<details>` makes the contents reachable without JavaScript; it does not
    // keep them visible while scrolling. The comment must not claim otherwise.
    expect(postScreen).toContain("<details");
    expect(postScreen).toContain("<summary");
    expect(postScreen).toContain("xl:hidden");
    expect(postScreen).toContain("reachable");
    expect(postScreen).not.toMatch(/persistent narrow-viewport navigator[^.]*is implemented here/);
  });

  test("drops the table-of-contents thumb indicator", () => {
    // Preference, not correctness: the falsified rationale (a `useLayoutEffect`
    // measurement misaligning inside a closed `<details>`) is recorded in the
    // screen, and the installed version measures in `useEffect` with an early
    // return at zero height.
    expect(postScreen).toMatch(/<TOCItems thumbBox=\{false\}>/);
  });

  test("the reading column carries the production measure, not a pixel constant", () => {
    expect(postScreen).toContain("max-w-[var(--blog-measure)]");
    expect(postScreen).not.toContain("max-w-[860px]");
    expect(postScreen).not.toContain("max-w-[1160px]");
  });

  test("the rail consumes the toc-rail alias instead of a hard-coded width", () => {
    expect(postScreen).toContain("w-[var(--blog-toc-rail)]");
    expect(postScreen).not.toContain("w-[240px]");
  });

  test("the body has a fallback sized like the column it replaces", () => {
    expect(postScreen).toContain("<Suspense");
    expect(postScreen).toContain("aria-busy");
  });

  test("treats an authored cover as part of the article masthead", () => {
    expect(postScreen).toContain('className="text-4xl leading-tight sm:text-5xl"');
    expect(postScreen).toContain("data.image === undefined ? null");
    expect(postScreen).toContain("src={data.image}");
    expect(postScreen).toContain('alt=""');
    expect(postScreen.indexOf("<BlogPostMeta")).toBeLessThan(postScreen.indexOf("src={data.image}"));
    expect(postScreen.indexOf("src={data.image}")).toBeLessThan(postScreen.indexOf("<BlogTocDisclosure"));
  });
});

describe("article metadata line", () => {
  test("updated is omitted entirely when the author did not record one", () => {
    // A synthesised or empty `updated` would claim a provenance signal this
    // design exists to keep trustworthy.
    expect(meta).toMatch(/data\.updated === undefined \? null :/);
  });

  test("the translation entry only exists when the other locale has a file", () => {
    expect(meta).toMatch(/alternateLocale === undefined \? null :/);
    expect(languageEntry).toContain("hrefLang={alternateLocale}");
    // The language name is written in its own language and tagged as such.
    expect(languageEntry).toContain("<span lang={alternateLocale}>");
  });

  test("the translation entry is named by its text, with no overriding label", () => {
    // The visible text is the accessible name, so it already matches what a
    // voice-control user says. An `aria-label` would take over the naming and
    // the inner `<span lang>` would stop counting — the language name would be
    // read in the page's language, which is what the tag prevents.
    expect(languageEntry).not.toMatch(/aria-label=/);
    expect(languageEntry).toMatch(
      /\{t\.blogReadIn\} <span lang=\{alternateLocale\}>\{name\}<\/span>/,
    );
  });

  test("the category is a pill on the article and still a category URL", () => {
    expect(meta).toContain("<CategoryChip lang={locale} category={data.category} pill />");
  });
});

describe("article closing block", () => {
  test("always renders, so an article never ends without a way back", () => {
    // Only the neighbour rows are conditional; the back link is unconditional.
    expect(closing).not.toMatch(/return null/);
    expect(closing).toContain("blog-post__closing");
    expect(closing).toMatch(/<p className="mt-6">\s*<Link\s+to=\{blogIndexPath\(locale\)\}/);
  });

  test("the back links mark the blog index current only on the blog index", () => {
    // `Link` marks a route active by prefix match, so a link to `/blog` from
    // `/blog/<slug>` announced `aria-current="page"` on an article — the reader
    // was told the index was the page they were on. The option has to sit on the
    // link that points at the index, so this asserts per link tag: counting the
    // option anywhere in the file would pass with it on the neighbour links.
    // Two, not three: the metadata line's back link was removed on request. The
    // invariant is unchanged — every Link that points at the index carries the
    // option — and the count still catches a link added without it.
    const backTags = [
      ...(closing.match(/<Link\b[^>]*>/g) ?? []),
      ...(meta.match(/<Link\b[^>]*>/g) ?? []),
      ...(notFound.match(/<Link\b[^>]*>/g) ?? []),
    ].filter((tag) => tag.includes("to={blogIndexPath("));
    expect(backTags.length).toBe(2);
    expect(meta).not.toContain("to={blogIndexPath(");
    for (const tag of backTags) {
      expect(tag).toContain("activeOptions={{ exact: true }}");
    }
  });

  test("neighbours are individual rows that can each be absent", () => {
    // Rows are built before the list is rendered, so an absent neighbour leaves
    // no element behind: the first version emitted an empty `<li>` and an empty
    // `<nav>` when a post had no neighbours at all.
    expect(closing).toMatch(/if \(previous !== undefined\) \{/);
    expect(closing).toMatch(/if \(next !== undefined\) \{/);
    expect(closing).toMatch(/rows\.length === 0 \? null :/);
    expect(closing).toMatch(/rows\.map\(\(row\) =>/);
    expect(closing).not.toMatch(/\{previous === undefined \? null :/);
  });

  test("labels the neighbours by time, not by list position", () => {
    // The index is ordered by date, so "previous"/"next" would ambiguously mean
    // either list position or time.
    expect(closing).toContain("t.blogEarlierPost");
    expect(closing).toContain("t.blogNewerPost");
    expect(closing).not.toContain("blogPrevious");
    expect(closing).not.toContain("blogNext\"");
  });
});

describe("blog not-found body", () => {
  test("keeps the reader inside the blog surface", () => {
    expect(notFound).toContain("BlogSurface");
    expect(enRoute).toContain("notFoundComponent");
    expect(langRoute).toContain("notFoundComponent");
  });

  test("the route turns an invisible post into not-found instead of rendering it", () => {
    // Text pins, and they are the only coverage this layer has: the visibility rule
    // is asserted behaviourally against the loader, but a route that read the source
    // for itself would serve a draft in production without failing anything — and the
    // prerendered artifact stays clean either way, because the crawl never visits a
    // link that is not there. So the route must consult the loader and turn its
    // absence into not-found.
    //
    // What these pins can and cannot hold, measured by the round-6 review: they
    // accept a renamed local and a block-form throw (behaviour-identical rewordings),
    // and comment-only lines are dropped so prose about the code does not fail the
    // suite. They cannot see a route that reaches the source through another server
    // module or a rebuilt registry — in those spellings the suite stays green while
    // production serves the draft, which is a real limit of pinning text and is
    // disclosed in the change's notes rather than papered over here.
    const code = (text: string) =>
      text
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
        .join("\n");
    for (const route of [code(enRoute), code(langRoute)]) {
      expect(route).toMatch(/loadBlogPost\(data\)/);
      expect(route).toMatch(/throw notFound\(\)/);
      expect(route).not.toContain("blogSource");
      expect(route).not.toContain("pickFrontmatter");
    }
  });

  test("the way out is not announced as the page the reader is on", () => {
    // Measured on the built 404 in both locales: the back link carried
    // `aria-current="page"` (prefix match on `/blog/no-such-post`), so the exit
    // was announced as the current page on the one screen where the reader is
    // definitely lost. The missing post is missing in both locales, so the
    // language control is off here too: it would hand the reader another 404.
    const back = (notFound.match(/<Link\b[^>]*>/g) ?? []).find((tag) =>
      tag.includes("to={blogIndexPath("),
    );
    expect(back).toContain("activeOptions={{ exact: true }}");
    expect(notFound).toContain("withLanguageToggle={false}");
  });

  test("the article turns the navbar's language control off", () => {
    // The control only swaps the locale prefix and cannot know whether the target
    // page exists. On a drafted translation the prerender crawl followed it into a
    // 404 and failed the whole build, so the article carries its own accurate
    // entry instead. Deleting this prop silently brings the crawl back and leaves
    // the 404 screen's identical prop — and every other test in the suite — green:
    // the round-4 review passed exactly that mutation.
    expect(postScreen).toContain("withLanguageToggle={false}");
  });
});

describe("article style adapter", () => {
  test("heading anchors are visible at rest, not only on hover", () => {
    // A hover-only anchor cannot be reached on a touch device.
    expect(rules).toMatch(
      /button\[aria-label\]\s*\{[^}]*opacity:\s*1/,
    );
    expect(rules).toMatch(/button\[aria-label\]:hover/);
  });

  test("block rhythm comes from the production spacing scale", () => {
    expect(rules).toMatch(
      /\.blog-post__reading \.prose :is\(h2\)\s*\{[^}]*margin-top:\s*var\(--lore-space-block\)/,
    );
    expect(rules).toMatch(
      /\.blog-post__reading \.prose :is\(h2\)\s*\{[^}]*margin-bottom:\s*var\(--lore-space-group\)/,
    );
    expect(rules).toMatch(
      /\.blog-post__reading \.prose :is\(h3\)\s*\{[^}]*margin-top:\s*var\(--lore-space-panel\)/,
    );
    expect(rules).toMatch(
      /\.blog-post__reading \.prose :is\(h3\)\s*\{[^}]*margin-bottom:\s*var\(--lore-space-related\)/,
    );
  });

  test("scopes the prose rules to the reading wrapper, outside the disclosure", () => {
    // Fumadocs TOC entries are `.prose` elements themselves. While the narrow
    // viewport disclosure rendered them inside `article`, the article-scoped
    // body rules landed on them: measured 16px/26px against the rail's 14px/20.
    const wrapper = 'className="blog-post__reading"';
    expect(postScreen.split(wrapper).length - 1).toBe(1);

    const fromWrapper = postScreen.slice(postScreen.indexOf(wrapper));
    expect(fromWrapper).toContain("<DocsBody>");
    expect(fromWrapper).toContain("</DocsBody>");
    expect(postScreen.indexOf("BlogTocDisclosure")).toBeLessThan(
      postScreen.indexOf(wrapper),
    );
  });

  test("paragraphs break long tokens in every locale, not only in CJK", () => {
    expect(rules).toMatch(/\.blog-post__reading \.prose p\s*\{[^}]*overflow-wrap:\s*break-word/);
  });

  test("the shell reserves the left column, the reading column and the rail", () => {
    // This pinned `.blog-scope.blog-post__frame`'s max-width, which computed
    // `reading measure + rail + gaps` and centred it — the arithmetic behind the
    // 976px island (measured: the rail sat 241px from the right edge at 1440 and
    // 481px at 1920). The shell replaced it, so the assertion moves to the shell
    // and keeps the same demand: the three columns must all have a track, and the
    // side tracks must reference the aliases rather than repeat their values.
    expect(rules).toMatch(
      /@media \(min-width: 1280px\)\s*\{\s*\.blog-shell\s*\{[^}]*grid-template-columns:\s*var\(--blog-shell-sidebar\)\s+minmax\(0, 1fr\)\s+var\(--blog-toc-rail\)/,
    );
    expect(rules).toMatch(
      /@media \(min-width: 1024px\)\s*\{\s*\.blog-shell\s*\{[^}]*grid-template-columns:\s*var\(--blog-shell-sidebar\)\s+minmax\(0, 1fr\)/,
    );
    // And the reading column keeps its own measure: the shell spans the
    // surface, the text does not.
    expect(postScreen).toContain("max-w-[var(--blog-measure)]");
  });

  test("contents entries take the brand channel when active", () => {
    expect(rules).toMatch(/a\[data-active="true"\]\s*\{[^}]*color:\s*var\(--primary\)/);
    expect(rules).toMatch(/a\[data-active="false"\]\s*\{[^}]*color:\s*color-mix/);
  });
});
