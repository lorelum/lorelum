import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const navbar = readFileSync(new URL("./landing-navbar.tsx", import.meta.url), "utf8");
const destinations = readFileSync(
  new URL("./landing-primary-navigation.tsx", import.meta.url),
  "utf8",
);

/**
 * Each `<Link …>…</Link>` element, so a prop can be pinned to the link it belongs
 * to — including the label, which is the link's child rather than one of its props.
 */
const destinationLinks = destinations.match(/<Link\b[^>]*>[\s\S]*?<\/Link>/g) ?? [];
/** Each `<Link …>` opening tag, for the assertions about props alone. */
const destinationTags = destinationLinks.map((link) => link.match(/^<Link\b[^>]*>/)?.[0] ?? "");
const navbarTags = navbar.match(/<Link\b[^>]*>/g) ?? [];

describe("landing navigation current-location rule", () => {
  test("the destination comes from the pathname, not from the link's own href", () => {
    // The href is the canonical unprefixed path (`/blog`) while the reader may be
    // on the prefixed spelling (`/en/blog/...`), so the router's own comparison
    // answered "nowhere" on those pages.
    // The rule itself is a pure function with both answers tested; here the
    // component must (a) call it and (b) keep the mark conditional. Two weaker
    // versions of this assertion passed earlier versions of this file: one that
    // matched the function name alone, and one that matched the ternary but not
    // the sign of the call. So the whole expression is pinned at both call
    // sites, negation included — and the pattern is line-ending agnostic, because
    // a plain `git checkout --` on Windows (`core.autocrlf=true`) writes CRLF and
    // a literal `\n` join then fails the gate on a fresh checkout.
    expect(destinations).toMatch(
      /const mark = \(destination: NavigationDestination\) =>\s+isCurrentDestination\(pathname, destination, i18n\.languages\)\s+\? \("page" as const\)\s+: undefined;/,
    );
    expect(navbar).toContain(
      'const onHome = isCurrentDestination(pathname, "home", i18n.languages);',
    );
    expect(destinations).not.toContain("!isCurrentDestination");
    expect(navbar).not.toContain("!isCurrentDestination");
    // The pinned expressions are only as good as their input: with `pathname`
    // replaced by a constant the four marks stop depending on the route at all
    // (the round-4 review passed exactly that mutation), so the source of the
    // value is pinned too.
    expect(destinations).toMatch(/const \{\s*pathname\s*\} = useLocation\(\)/);
    expect(navbar).toMatch(/const \{\s*pathname\s*\} = useLocation\(\)/);
  });

  test("each destination link marks itself, and silences the router's prefix match", () => {
    // `Link` marks a target active by prefix, which said "Home" on `/zh/blog/...`
    // and "Blog" on `/blog/<slug>`. One text-only mark decides instead — and the
    // mark has to be on the same element as the exact option, which is why this
    // asserts per link tag rather than on the file's text as a whole.
    expect(destinationTags.length).toBe(3);
    // Every destination link carries the mark of its own destination: three
    // attributes, each naming the link it sits on. The target is pinned too —
    // an assertion on `mark("docs")` alone also holds when the docs link is
    // pointed at the blog, which would mark two links current on `/blog/<slug>`
    // (measured: that mutation passed this file before the targets were pinned).
    expect(destinationTags.filter((t) => t.includes("aria-current")).length).toBe(3);
    const contracts: Record<string, string[]> = {
      home: [
        'to={destinationPath("home", lang, i18n.defaultLanguage)}',
        "activeOptions={{ exact: true }}",
        'aria-current={mark("home")}',
        "{t.navHome}",
      ],
      docs: [
        'to="/$lang/docs/$"',
        'params={{ lang, _splat: "" }}',
        "activeOptions={{ exact: true }}",
        'aria-current={mark("docs")}',
        "{t.navDocs}",
      ],
      blog: [
        'to={destinationPath("blog", lang, i18n.defaultLanguage)}',
        "activeOptions={{ exact: true }}",
        'aria-current={mark("blog")}',
        "{t.navBlog}",
      ],
    };
    // The label is pinned with the destination: swapping the two labels (or the
    // two targets) leaves every other assertion here satisfied while the header
    // sends readers to the wrong page — a mutation the round-4 review passed. The
    // label is the link's child, so the whole element is matched, not the tag.
    for (const [destination, expected] of Object.entries(contracts)) {
      const link = destinationLinks.find((element) => element.includes(`mark("${destination}")`));
      expect(link).toBeDefined();
      for (const contract of expected) {
        expect(link).toContain(contract);
      }
    }
  });

  test("the brand link marks the home destination, not the URL spelling", () => {
    // The brand link to `/zh` was marked current on every ZH sub-page (measured
    // in `probe-chrome`), and after exact matching it stayed silent on `/en`,
    // where the header's Home link was marked.
    const brand = navbarTags.find((tag) => tag.includes("to={homePath}"));
    expect(brand).toBeDefined();
    expect(brand).toContain("activeOptions={{ exact: true }}");
    expect(brand).toContain('aria-current={onHome ? "page" : undefined}');
  });

  test("the language control is on by default; a surface can give it a target or turn it off", () => {
    // The blog 404 passes `withLanguageToggle={false}` (the post is missing in both
    // languages); the article passes `languageHref` (its translation, or the other
    // language's index) because the default prefix swap cannot know whether the
    // target exists — on a drafted translation the prerender crawl followed it into
    // a 404 and failed the build. Flipping this default removes the control from
    // every other surface (landing, docs, index) while every other test still
    // passes; the round-4 review passed exactly that mutation.
    expect(navbar).toMatch(/withLanguageToggle = true/);
    expect(navbar).toContain(
      "withLanguageToggle ? <LanguageToggle lang={lang} href={languageHref} /> : null",
    );
  });
});
