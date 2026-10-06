import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const controls = readFileSync(new URL("./blog-index-controls.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./blog-search-dialog.tsx", import.meta.url), "utf8");
const select = readFileSync(new URL("../../../../../../packages/ui/src/components/select.tsx", import.meta.url), "utf8");

describe("blog discovery control consistency", () => {
  test("uses two shared rectangular selectors instead of exposed pills", () => {
    expect(controls).toContain('import { Select } from "@lorelum/ui"');
    expect(controls.match(/<Select</g)?.length).toBe(2);
    expect(controls).toContain('data-blog-controls="category"');
    expect(controls).toContain('data-blog-controls="sort"');
    expect(select).toContain("rounded-[var(--radius)]");
    expect(controls).not.toContain("rounded-full");
    expect(controls).not.toContain("lore-radius-pill");
  });

  test("keeps options derived from posts and preserves all query state", () => {
    expect(controls).toContain("offeredCategories(posts)");
    expect(controls).toContain("blogSorts.map");
    expect(controls).toContain('search: { category: candidate === "all" ? undefined : candidate, sort, q }');
    expect(controls).toContain("search: { category, sort: candidate, q }");
    expect(controls).toContain("search={{ category: undefined, sort: undefined, q: undefined }}");
  });

  test("uses the docs search dialog rather than a hover-only inline field", () => {
    expect(controls).toContain("<BlogSearchDialog lang={lang} posts={posts} category={category} sort={sort} q={q}");
    expect(controls).not.toContain('id="blog-search"');
    expect(dialog).toContain('from "fumadocs-ui/components/dialog/search"');
    for (const part of ["SearchDialogOverlay", "SearchDialogContent", "SearchDialogInput", "SearchDialogList", "SearchDialogClose"]) expect(dialog).toContain(`<${part}`);
    expect(dialog).not.toContain("<kbd");
  });

  test("keeps reset, touch targets and keyboard focus", () => {
    expect(controls).toContain("data-blog-reset");
    expect(controls).toContain("min-h-[var(--lore-size-touch)]");
    expect(controls).toContain("focus-visible:outline-[var(--ring)]");
    expect(select).toContain("min-w-[var(--lore-size-touch)]");
    expect(dialog).toContain("finalFocus={trigger}");
  });
});
