import { describe, expect, test } from "bun:test";
import { type IndexBlock, layoutIndex } from "./index-layout";
import type { BlogIndexEntry } from "./list-posts";

function entries(n: number): BlogIndexEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `post-${i}`,
    locale: "en",
    data: {
      title: `Post ${i}`,
      description: "d",
      date: "2026-01-01",
      category: "benchmark",
      author: "a",
    },
  })) as unknown as BlogIndexEntry[];
}

/** The entries a block shows, in reading order. */
function slugsOf(block: IndexBlock): string[] {
  switch (block.kind) {
    case "hero":
      return [block.lead, ...block.sides].map((e) => e.slug);
    case "grid":
      return block.items.map((e) => e.slug);
    case "band":
      return [block.entry.slug];
    case "split":
      return [block.feature, ...block.list].map((e) => e.slug);
  }
}

const shape = (n: number) => layoutIndex(entries(n)).map((b) => `${b.kind}:${slugsOf(b).length}`);

describe("layoutIndex", () => {
  test("a list of one is a lone hero, and an empty list has no blocks", () => {
    expect(layoutIndex([])).toEqual([]);
    expect(shape(1)).toEqual(["hero:1"]);
  });

  test("the hero takes the lead plus up to two side images", () => {
    expect(shape(2)).toEqual(["hero:2"]);
    expect(shape(3)).toEqual(["hero:3"]);
  });

  test("after the hero come grid, band, split in that order, each as full as the list allows", () => {
    expect(shape(4)).toEqual(["hero:3", "grid:1"]);
    expect(shape(6)).toEqual(["hero:3", "grid:3"]);
    expect(shape(7)).toEqual(["hero:3", "grid:3", "band:1"]);
    expect(shape(9)).toEqual(["hero:3", "grid:3", "band:1", "split:2"]);
    expect(shape(12)).toEqual(["hero:3", "grid:3", "band:1", "split:5"]);
  });

  test("a lone entry where a split would open is a band, never a split without thumbnails", () => {
    expect(shape(8)).toEqual(["hero:3", "grid:3", "band:1", "band:1"]);
    for (let n = 1; n <= 60; n++) {
      for (const block of layoutIndex(entries(n))) {
        if (block.kind === "split") expect(block.list.length).toBeGreaterThan(0);
      }
    }
  });

  test("the cycle repeats once a split is full", () => {
    expect(shape(13)).toEqual(["hero:3", "grid:3", "band:1", "split:5", "grid:1"]);
    expect(shape(24)).toEqual([
      "hero:3",
      "grid:3",
      "band:1",
      "split:5",
      "grid:3",
      "band:1",
      "split:5",
      "grid:3",
    ]);
  });

  test("every entry appears exactly once, in order, whatever the length", () => {
    for (let n = 0; n <= 40; n++) {
      const input = entries(n).map((e) => e.slug);
      const out = layoutIndex(entries(n)).flatMap(slugsOf);
      expect(out).toEqual(input);
    }
  });

  test("a block never renders empty", () => {
    for (let n = 1; n <= 40; n++) {
      for (const block of layoutIndex(entries(n))) {
        expect(slugsOf(block).length).toBeGreaterThan(0);
      }
    }
  });
});
