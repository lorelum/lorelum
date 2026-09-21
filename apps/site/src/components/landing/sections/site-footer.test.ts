import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const footer = readFileSync(new URL("./site-footer.tsx", import.meta.url), "utf8");

/** Each `<Link …>` opening tag, so a prop can be pinned to the link it belongs to. */
const linkTags = footer.match(/<Link\b[^>]*>/g) ?? [];

describe("site footer navigation", () => {
  test("links the blog for the current locale", () => {
    // The footer is the only navigation on every surface, so it was where a
    // reader who landed deep inside the docs or the blog looked for the other
    // one — and it had no blog entry at all.
    const blogLink = linkTags.find((tag) => tag.includes('destinationPath("blog"'));
    expect(blogLink).toBeDefined();
    expect(blogLink).toContain('to={destinationPath("blog", lang, i18n.defaultLanguage)}');
    expect(footer).toContain("t.navBlog");
  });

  test("the blog link states the reader's destination, whichever spelling they came by", () => {
    // Two failures lived here: prefix matching marked `/blog` current on
    // `/blog/<slug>` (the reader was on an article), and after that was
    // silenced by exact matching the link stayed silent on `/en/blog`, where
    // the header said the reader was on the blog. The rule is now the header's
    // rule — the destination, not the URL spelling.
    const blogLink = linkTags.find((tag) => tag.includes('destinationPath("blog"'));
    expect(blogLink).toContain("activeOptions={{ exact: true }}");
    expect(blogLink).toContain('aria-current={onBlog ? "page" : undefined}');
    // The whole assignment is pinned, not just the function name: a call site
    // that negated the rule (`!isCurrentDestination(...)`) would otherwise read
    // as correct here. `not.toContain` states the same thing from the other
    // side, so a negation added anywhere in the file fails this test.
    expect(footer).toContain(
      'const onBlog = isCurrentDestination(pathname, "blog", i18n.languages);',
    );
    expect(footer).not.toContain("!isCurrentDestination");
    // The pinned expression is only as good as its input: with `pathname` replaced
    // by a constant the footer marks the blog on every page while the assertions
    // above still match (the round-4 review passed exactly that mutation).
    expect(footer).toMatch(/const \{\s*pathname\s*\} = useLocation\(\)/);
    // And exactly one footer link may carry the mark — otherwise the attribute
    // could be moved to another link while this file still passed.
    expect(linkTags.filter((tag) => tag.includes("aria-current")).length).toBe(1);
  });
});
