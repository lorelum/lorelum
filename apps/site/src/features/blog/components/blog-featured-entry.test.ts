import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coverCells } from "../model/cover-pattern";

const featured = readFileSync(new URL("./blog-featured-entry.tsx", import.meta.url), "utf8");
const row = readFileSync(new URL("./blog-card.tsx", import.meta.url), "utf8");
const blocks = readFileSync(new URL("./blog-index-blocks.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./blog-index-controls.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/blog.css", import.meta.url), "utf8");
const cover = readFileSync(new URL("./blog-cover.tsx", import.meta.url), "utf8");

describe("brand editorial feature", () => {
  test("keeps the stage square, clipping only the image and never the title focus", () => {
    expect(featured).not.toContain("rounded-[var(--lore-radius-stage)]");
    // The stage clips the image's hover zoom to its square edge. The title link
    // sits in the reading block after it, so its focus ring is never clipped.
    expect(featured.match(/overflow-hidden/g)).toHaveLength(1);
    expect(featured.indexOf("overflow-hidden")).toBeLessThan(featured.indexOf("blog-featured-reading"));
    expect(featured).toContain("blog-featured-entry relative cursor-pointer");
    expect(styles).toContain("outline-color: var(--ring)");
  });

  test("promotes only the lead entry while the rest are bordered cards in one list", () => {
    // Exactly one lead stage, fed the hero's lead: a second `BlogFeaturedEntry`
    // anywhere would give several eager, high-priority stages.
    expect(blocks.match(/<BlogFeaturedEntry\b/g)?.length).toBe(1);
    expect(blocks).toContain("entry={block.lead}");
    // One list for the whole index, so assistive tech reports the real count.
    expect(blocks.match(/<ul\b/g)?.length).toBe(1);
    expect(row).toContain("border border-[var(--blog-hairline)]");
    expect(row).toContain("languageHintKey(entry.locale, lang)");
    expect(featured).toContain("data-blog-featured");
    expect(featured).not.toContain("shadow-");
    expect(featured).not.toContain("border border-");
  });

  test("keeps the image first, then title, real metadata and full summary", () => {
    expect(featured.indexOf("<BlogCover")).toBeLessThan(featured.indexOf("<h2"));
    expect(featured.indexOf("<h2")).toBeLessThan(featured.indexOf("<BlogEntryMeta"));
    expect(featured.indexOf("<BlogEntryMeta")).toBeLessThan(featured.indexOf("{entry.data.description}"));
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

  test("keeps the lead's title off the stage and its focus ring a themed token", () => {
    expect(featured.indexOf("<h2")).toBeGreaterThan(featured.indexOf("blog-featured-reading"));
    expect(styles).toContain(".blog-scope .blog-featured-entry .blog-title-link:hover");
    expect(styles).toContain("outline-color: var(--ring)");
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
    expect(row).toContain("blog-card relative flex min-w-0 cursor-pointer");
    expect(styles).toContain("@media (hover: hover) and (pointer: fine)");
    expect(styles).toContain(".blog-featured-entry:hover .blog-featured-reading");
    expect(styles).toContain(".blog-featured-entry:focus-within .blog-featured-stage");
    expect(styles).toContain(".blog-card:focus-within .blog-card-cover > :is(img, svg)");
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
    expect(row).toContain('<BlogCover entry={entry} className="h-full w-full object-cover"');
  });

  test("preserves all 24 deterministic fallback cells in the feature", () => {
    expect(coverCells("measurement")).toHaveLength(24);
    expect(coverCells("measurement")).toEqual(coverCells("measurement"));
    expect(cover).toContain('aria-hidden="true"');
    expect(cover).toContain("coverCells(entry.slug)");
    expect(cover).toContain("data-tier={coverTierIndex(cell.opacity)}");
  });
});
