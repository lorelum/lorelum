import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const controls = readFileSync(new URL("./blog-index-controls.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./blog-search-dialog.tsx", import.meta.url), "utf8");

describe("blog discovery control consistency", () => {
  test("shows ALL and real category names with an explicit current destination", () => {
    expect(controls).toContain("{t.blogCategoryAll}");
    expect(controls).toContain("{t[categoryLabelKey(candidate)]}");
    expect(controls).toContain('aria-current={category === undefined ? "page" : undefined}');
    expect(controls).toContain('aria-current={category === candidate ? "page" : undefined}');
  });

  test("marks only the chosen destination current, not ALL or Reset by subset match", () => {
    expect(controls).toContain("explicitUndefined: true");
    const linkOptions = [...controls.matchAll(/activeOptions=\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    expect(linkOptions).toHaveLength(3);
    for (const options of linkOptions) expect(options).toBe("exactSearch");
  });

  test("uses a flat horizontal category navigation without dropdowns or pills", () => {
    expect(controls).toMatch(/<nav\s+aria-label=\{t\.blogFilterCategory\}/);
    expect(controls).not.toContain("<Select");
    expect(controls).toContain('data-blog-controls="category"');
    expect(controls).not.toContain('data-blog-controls="sort"');
    expect(controls).not.toContain('id="blog-sort"');
    expect(controls).toContain("var(--lore-font-mono)");
    expect(controls).toContain("uppercase");
    expect(controls).not.toContain("rounded-full");
    expect(controls).not.toContain("lore-radius-pill");
  });

  test("keeps options derived from posts and preserves all query state", () => {
    expect(controls).toContain("offeredCategories(posts)");
    expect(controls).not.toContain("blogSorts.map");
    expect(controls).toContain("search={{ category: undefined, sort, q }}");
    expect(controls).toContain("search={{ category: candidate, sort, q }}");
    expect(controls).toContain("category={category} sort={sort} q={q}");
    expect(controls).toContain("search={{ category: undefined, sort: undefined, q: undefined }}");
  });

  test("uses the docs search dialog rather than a hover-only inline field", () => {
    expect(controls).toContain(
      "<BlogSearchDialog lang={lang} posts={posts} category={category} sort={sort} q={q}",
    );
    expect(controls).not.toContain('id="blog-search"');
    expect(dialog).toContain('from "fumadocs-ui/components/dialog/search"');
    for (const part of [
      "SearchDialogOverlay",
      "SearchDialogContent",
      "SearchDialogInput",
      "SearchDialogList",
      "SearchDialogClose",
    ])
      expect(dialog).toContain(`<${part}`);
    expect(dialog).not.toContain("<kbd");
  });

  test("keeps reset, touch targets and keyboard focus", () => {
    expect(controls).toContain("data-blog-reset");
    expect(controls).toContain("min-h-[var(--lore-size-touch)]");
    expect(controls).toContain("focus-visible:outline-[var(--ring)]");
    expect(controls).toContain("min-w-[var(--lore-size-touch)]");
    expect(dialog).toContain("finalFocus={trigger}");
  });

  test("scrolls only the category row while allowing visible keyboard focus", () => {
    expect(controls).toContain("overflow-x-auto whitespace-nowrap px-1 py-1");
    expect(controls).toContain('className="min-w-0 lg:col-start-1 lg:row-start-1"');
    expect(controls).toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
    expect(controls).toContain("lg:justify-start");
    expect(controls).not.toContain("lg:justify-center");
    expect(controls).toContain("aria-[current=page]:text-fd-foreground");
    expect(controls).toContain("focus-visible:outline-offset-2");
    expect(controls).not.toContain('role="tablist"');
  });
});
