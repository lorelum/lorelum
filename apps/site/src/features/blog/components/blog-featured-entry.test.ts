import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coverCells } from "../model/cover-pattern";

const featured = readFileSync(new URL("./blog-featured-entry.tsx", import.meta.url), "utf8");
const row = readFileSync(new URL("./blog-entry-row.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./blog-index-controls.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/blog.css", import.meta.url), "utf8");
const cover = readFileSync(new URL("./blog-cover.tsx", import.meta.url), "utf8");

describe("brand editorial feature", () => {
  test("rounds the green stage with the existing design token without clipping title focus", () => {
    expect(featured).toContain("rounded-[var(--lore-radius-stage)]");
    expect(featured).not.toContain("overflow-hidden");
    expect(featured).toContain("blog-featured-entry relative cursor-pointer");
    expect(styles).toContain("outline-color: currentColor");
  });

  test("promotes only the designated entry while the rest stay hairline-separated", () => {
    expect(row).toContain("if (featured) return <BlogFeaturedEntry");
    expect(row).toContain("border-t border-[var(--blog-hairline)]");
    expect(featured).toContain("data-blog-featured");
    expect(featured).not.toContain("shadow-");
    expect(featured).not.toContain("border border-");
  });

  test("keeps title before cover before real metadata and full summary", () => {
    expect(featured.indexOf("<h2")).toBeLessThan(featured.indexOf("<BlogCover"));
    expect(featured.indexOf("<BlogCover")).toBeLessThan(featured.indexOf("<time"));
    expect(featured.indexOf("<time")).toBeLessThan(featured.indexOf("{entry.data.description}"));
    expect(featured).toContain("featuredTitleParts(entry.data.title)");
    expect(featured).not.toContain("line-clamp");
  });

  test("provides exactly one interactive title per entry", () => {
    for (const source of [featured, row]) {
      expect(source.match(/<Link\b/g)?.length).toBe(1);
      expect(source).not.toContain("<CategoryChip");
      expect(source).toContain("after:absolute after:inset-0");
      expect(source).toContain("blogPostPath(entry.locale, entry.slug)");
    }
  });

  test("uses readable theme colors and preserves a contrasting feature focus ring", () => {
    expect(featured).toContain("text-[var(--background)] dark:text-[var(--foreground)]");
    expect(styles).toContain(".blog-scope .blog-featured-stage .blog-title-link:hover");
    expect(styles).toContain("outline-color: currentColor");
    expect(featured).toContain("max-w-[var(--blog-measure)]");
  });

  test("keeps a named category filter without a sort setup section", () => {
    expect(controls).toContain("aria-label={t.blogFilterCategory}");
    expect(controls).not.toContain("aria-label={t.blogSortBy}");
    expect(controls).toContain("<nav aria-label={t.blogFilterCategory}");
    expect(controls).not.toContain('<p className="sr-only">{t.blogSortBy}</p>');
  });

  test("pairs restrained pointer feedback with keyboard feedback without moving the card", () => {
    expect(featured).toContain("cursor-pointer");
    expect(row).toContain("blog-entry-row relative cursor-pointer");
    expect(styles).toContain("@media (hover: hover) and (pointer: fine)");
    expect(styles).toContain(".blog-featured-entry:hover .blog-featured-stage");
    expect(styles).toContain(".blog-featured-entry:focus-within .blog-featured-stage");
    expect(styles).toContain(".blog-entry-row:focus-within .shrink-0 > :is(img, svg)");
    expect(styles).toContain("transition: transform 220ms ease");
    expect(styles).toContain("transform: scale(1.015)");
    expect(styles).not.toMatch(/\.blog-featured-entry\s*\{[^}]*transform:/);
  });
});

describe("editorial cover loading", () => {
  test("prioritizes the actual authored lead image without changing its source", () => {
    expect(featured).toContain("<BlogCover entry={entry} priority");
    expect(cover).toContain('loading={priority ? "eager" : "lazy"}');
    expect(cover).toContain('fetchPriority={priority ? "high" : undefined}');
    expect(cover).toContain("src={entry.data.image}");
    expect(cover).toContain('alt=""');
  });

  test("keeps ordinary authored covers lazy", () => {
    expect(cover).toContain("priority = false");
    expect(row).toContain('<BlogCover entry={entry} className="h-full w-full object-contain"');
  });

  test("preserves all 24 deterministic fallback cells in the feature", () => {
    expect(coverCells("measurement")).toHaveLength(24);
    expect(coverCells("measurement")).toEqual(coverCells("measurement"));
    expect(cover).toContain('aria-hidden="true"');
    expect(cover).toContain("coverCells(entry.slug)");
    expect(cover).toContain("data-tier={coverTierIndex(cell.opacity)}");
  });
});
