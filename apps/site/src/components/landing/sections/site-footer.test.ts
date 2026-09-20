import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const footer = readFileSync(new URL("./site-footer.tsx", import.meta.url), "utf8");

describe("site footer navigation", () => {
  test("links the blog for the current locale", () => {
    // The footer is the only navigation on every surface, so it was the place a
    // reader who landed deep inside the docs or the blog looked for the other
    // one — and it had no blog entry at all.
    expect(footer).toContain('destinationPath("blog", lang, i18n.defaultLanguage)');
    expect(footer).toContain("t.navBlog");
  });

  test("the blog link marks itself current only on the index", () => {
    // Prefix matching marked the footer's `/blog` link as the current page on
    // `/blog/<slug>`; the reader was on an article, not on the index.
    expect(footer).toContain("activeOptions={{ exact: true }}");
  });
});
