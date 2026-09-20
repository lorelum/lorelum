import { describe, expect, test } from "bun:test";
import { blogIndexPath, blogPostPath } from "./blog-routes";

describe("blogIndexPath", () => {
  test("leaves the default language unprefixed and prefixes the others", () => {
    expect(blogIndexPath("en")).toBe("/blog");
    expect(blogIndexPath("zh")).toBe("/zh/blog");
  });
});

describe("blogPostPath", () => {
  test("builds the path from the content's own locale", () => {
    expect(blogPostPath("en", "post-a")).toBe("/blog/post-a");
    expect(blogPostPath("zh", "post-a")).toBe("/zh/blog/post-a");
  });

  test("keeps multi-segment and hyphenated slugs intact", () => {
    expect(blogPostPath("zh", "2026/notes/deep-dive")).toBe("/zh/blog/2026/notes/deep-dive");
  });

  test("uses the content locale even when it differs from the page locale", () => {
    // The index merges both locales, so a zh-only entry rendered on the English
    // index must still link under /zh/blog — the regression this guards is a
    // page-locale href, which 404s because that slug has no English file.
    const pageLang = "en";
    const entryLocale = "zh";

    expect(blogPostPath(entryLocale, "zh-only")).toBe("/zh/blog/zh-only");
    expect(blogPostPath(entryLocale, "zh-only")).not.toBe(`${blogIndexPath(pageLang)}/zh-only`);
  });
});
