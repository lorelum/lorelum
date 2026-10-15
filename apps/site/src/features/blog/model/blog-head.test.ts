import { describe, expect, test } from "bun:test";
import { siteUrl } from "@/shared/config/site";
import { getStrings } from "@/shared/i18n/legacy-translations";
import type { BlogPostData } from "../server/load-blog-post";
import { blogIndexHead, blogPostHead } from "./blog-head";

function post(overrides: Partial<BlogPostData["data"]> = {}): BlogPostData {
  return {
    slug: "post-a",
    path: "content/blog/post-a.mdx",
    locale: "en",
    data: {
      title: "A measured claim",
      description: "What was measured and how.",
      date: "2026-09-18",
      category: "benchmark",
      author: "Yuchao Huang",
      draft: false,
      ...overrides,
    },
  };
}

function canonicalOf(head: { links: Array<{ rel: string; href: string }> }): string | undefined {
  return head.links.find((link) => link.rel === "canonical")?.href;
}

function metaValue(head: { meta: Record<string, string>[] }, key: string): string | undefined {
  return head.meta.find((entry) => entry.name === key || entry.property === key)?.content;
}

/** TanStack's document title is `{ title }`, not `{ name: "title" }`. */
function titleOf(head: { meta: Record<string, string>[] }): string | undefined {
  return head.meta.find((entry) => typeof entry.title === "string")?.title;
}

describe("blogIndexHead", () => {
  test("canonicalises the default language to the unprefixed path", () => {
    expect(canonicalOf(blogIndexHead("en"))).toBe(`${siteUrl}/blog`);
    expect(canonicalOf(blogIndexHead("zh"))).toBe(`${siteUrl}/zh/blog`);
  });

  test("uses the shared index description for both the meta and the page copy", () => {
    // One key feeds the description meta tag and the visible dek, so the two
    // cannot drift apart.
    const head = blogIndexHead("zh");

    expect(metaValue(head, "description")).toBe(getStrings("zh").blogIndexDescription);
  });

  test("never produces an undefined canonical for an unknown locale", () => {
    const canonical = canonicalOf(blogIndexHead("fr"));

    expect(canonical).toBeDefined();
    expect(canonical).toContain("/fr/blog");
  });
});

describe("blogPostHead", () => {
  test("builds the canonical from the page's locale path plus the slug", () => {
    expect(canonicalOf(blogPostHead("en", post()))).toBe(`${siteUrl}/blog/post-a`);
    expect(canonicalOf(blogPostHead("zh", post()))).toBe(`${siteUrl}/zh/blog/post-a`);
  });

  test("carries the article title, description and published date", () => {
    const head = blogPostHead("en", post({ title: "T", description: "D", date: "2026-01-02" }));

    expect(titleOf(head)).toBe("T | Lorelum");
    expect(metaValue(head, "og:description")).toBe("D");
    expect(metaValue(head, "article:published_time")).toBe("2026-01-02");
  });

  test("falls back to a plain title and no canonical when the post is missing", () => {
    const head = blogPostHead("en", undefined);

    expect(titleOf(head)).toBe("Blog | Lorelum");
    expect(head.links).toEqual([]);
  });

  test("reports the locale of the page it is generated for", () => {
    expect(metaValue(blogPostHead("zh", post()), "og:locale")).toBe("zh_CN");
    expect(metaValue(blogPostHead("en", post()), "og:locale")).toBe("en_US");
  });
});
