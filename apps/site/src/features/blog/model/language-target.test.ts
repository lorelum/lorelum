import { describe, expect, test } from "bun:test";
import { articleLanguageTarget } from "./language-target";

describe("articleLanguageTarget", () => {
  test("goes to the translation when the other locale publishes the post", () => {
    expect(articleLanguageTarget({ lang: "en", slug: "a-post", alternateLocale: "zh" })).toBe("/zh/blog/a-post");
    expect(articleLanguageTarget({ lang: "zh", slug: "a-post", alternateLocale: "en" })).toBe("/blog/a-post");
  });

  test("falls back to the other language's blog index, never to a missing translation", () => {
    // Without a published translation the shared control's prefix swap would
    // answer 404 (and once failed the prerender crawl); the index always exists.
    expect(articleLanguageTarget({ lang: "en", slug: "a-post" })).toBe("/zh/blog");
    expect(articleLanguageTarget({ lang: "zh", slug: "a-post" })).toBe("/blog");
  });
});
