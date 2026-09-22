import { describe, expect, test } from "bun:test";
import type { BlogCategory } from "../content/frontmatter";
import type { BlogIndexEntry } from "./list-posts";
import { offeredCategories } from "./sidebar-categories";

const entry = (slug: string, category: BlogCategory): BlogIndexEntry => ({
  slug,
  locale: "en",
  data: {
    title: slug,
    description: `${slug} description`,
    date: "2026-09-18",
    category,
    author: "Lorelum",
    draft: false,
  },
});

describe("offeredCategories", () => {
  test("offers only the categories a visible entry carries", () => {
    // The vocabulary has more values than the list uses, and the sidebar must not
    // advertise the difference: a link to an empty list is a dead end.
    expect(offeredCategories([entry("a", "benchmark")])).toEqual(["benchmark"]);
    expect(offeredCategories([entry("a", "packs"), entry("b", "benchmark")])).toEqual([
      "benchmark",
      "packs",
    ]);
  });

  test("keeps the vocabulary's order rather than the entries'", () => {
    const forward = offeredCategories([entry("a", "benchmark"), entry("b", "packs")]);
    const reversed = offeredCategories([entry("b", "packs"), entry("a", "benchmark")]);

    expect(forward).toEqual(reversed);
  });

  test("offers nothing when nothing is visible", () => {
    // The caller passes the list it renders, which already excludes drafts; an
    // empty list is the n=0 state and must not produce dangling navigation.
    expect(offeredCategories([])).toEqual([]);
  });

  test("does not mutate or reorder its input", () => {
    const entries = [entry("b", "packs"), entry("a", "benchmark")];
    const before = entries.map((item) => item.slug);

    offeredCategories(entries);

    expect(entries.map((item) => item.slug)).toEqual(before);
  });
});
