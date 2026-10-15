import { describe, expect, test } from "bun:test";
import type { TOCItemType } from "fumadocs-core/toc";
import { readingTocItems } from "./toc-items";

const item = (url: string, depth: number): TOCItemType => ({ url, title: url, depth });

describe("readingTocItems", () => {
  test("keeps the depths the rail is sized for", () => {
    // h2 and h3 are the structure a reader navigates by; anything deeper is a
    // sub-detail of a section rather than a destination.
    const items = [item("#a", 2), item("#b", 3), item("#c", 4), item("#d", 5)];

    expect(readingTocItems(items).map((entry) => entry.url)).toEqual(["#a", "#b"]);
  });

  test("keeps h1, so a document that starts at h1 is not empty", () => {
    // `rehypeToc` collects h1–h6. A post that leads with h1 would otherwise
    // produce a rail that renders nothing at all.
    expect(readingTocItems([item("#top", 1)]).map((entry) => entry.url)).toEqual(["#top"]);
  });

  test("preserves document order and does not mutate the input", () => {
    const items = [item("#a", 3), item("#b", 2), item("#c", 6)];
    const kept = readingTocItems(items);

    expect(kept.map((entry) => entry.url)).toEqual(["#a", "#b"]);
    expect(items.map((entry) => entry.url)).toEqual(["#a", "#b", "#c"]);
  });

  test("passes the item objects through unchanged", () => {
    // The rail renders `item.title` and passes `item` to Fumadocs' TOCItem, so
    // the filter must not rebuild the item.
    const items = [item("#a", 2)];
    expect(readingTocItems(items)[0]).toBe(items[0]);
  });

  test("an empty table of contents stays empty", () => {
    expect(readingTocItems([])).toEqual([]);
  });
});
