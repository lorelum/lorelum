import { describe, expect, test } from "bun:test";
import { layoutIndex, parseBlogPage } from "./index-layout";
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

describe("parseBlogPage", () => {
  test("accepts positive integer numbers and numeric strings", () => {
    for (const value of [1, 2, 26, "1", "2", "26", " 3 "]) {
      expect(parseBlogPage(value)).toBe(Number(value));
    }
  });

  test("defaults invalid URL values to page one", () => {
    for (const value of [
      undefined,
      null,
      true,
      false,
      {},
      [],
      [2],
      "",
      " ",
      "two",
      "2oops",
      "NaN",
      "Infinity",
      "1.5",
      "0",
      "-2",
      NaN,
      Infinity,
      -Infinity,
      0,
      -2,
      1.5,
    ]) {
      expect(parseBlogPage(value)).toBe(1);
    }
  });
});

describe("layoutIndex", () => {
  test("reserves the first entry without counting it toward the 12-post window", () => {
    for (const [count, sizes] of [
      [1, [0]],
      [3, [2]],
      [12, [11]],
      [13, [12]],
      [26, [12, 12, 1]],
    ] as const) {
      const input = entries(count);
      for (let page = 1; page <= sizes.length; page++) {
        const layout = layoutIndex(input, { page, featureLatest: true });
        expect(layout.featured).toBe(page === 1 ? input[0] : undefined);
        expect(layout.posts.length).toBe(sizes[page - 1]);
        expect(layout.page).toBe(page);
        expect(layout.pageCount).toBe(sizes.length);
        expect(layout.total).toBe(count);
      }
    }
  });

  test("result mode never promotes an entry, even for short results", () => {
    for (const [count, sizes] of [
      [1, [1]],
      [3, [3]],
      [12, [12]],
      [13, [12, 1]],
      [26, [12, 12, 2]],
    ] as const) {
      const input = entries(count);
      for (let page = 1; page <= sizes.length; page++) {
        const layout = layoutIndex(input, { page, featureLatest: false });
        expect(layout.featured).toBeUndefined();
        expect(layout.posts.length).toBe(sizes[page - 1]);
        expect(layout.pageCount).toBe(sizes.length);
        expect(layout.total).toBe(count);
      }
    }
  });

  test("every entry appears exactly once across pages, preserving supplied order", () => {
    for (const featureLatest of [true, false]) {
      for (let count = 0; count <= 60; count++) {
        const input = entries(count).reverse();
        const first = layoutIndex(input, { page: 1, featureLatest });
        const observed: BlogIndexEntry[] = [];
        for (let page = 1; page <= first.pageCount; page++) {
          const layout = layoutIndex(input, { page, featureLatest });
          if (layout.featured) observed.push(layout.featured);
          observed.push(...layout.posts);
        }
        expect(observed).toEqual(input);
        expect(new Set(observed.map((entry) => entry.slug)).size).toBe(count);
      }
    }
  });

  test("empty results always have one empty page", () => {
    for (const featureLatest of [true, false]) {
      expect(layoutIndex([], { page: 99, featureLatest })).toEqual({
        featured: undefined,
        posts: [],
        page: 1,
        pageCount: 1,
        total: 0,
      });
    }
  });

  test("normalizes invalid page numbers and clamps valid oversized pages", () => {
    const input = entries(26);
    for (const featureLatest of [true, false]) {
      const first = layoutIndex(input, { page: 1, featureLatest });
      for (const page of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
        expect(layoutIndex(input, { page, featureLatest })).toEqual(first);
      }
      const last = layoutIndex(input, { page: 3, featureLatest });
      expect(layoutIndex(input, { page: 999, featureLatest })).toEqual(last);
      expect(last.featured).toBeUndefined();
      expect(last.page).toBe(3);
    }
  });

  test("does not mutate the input or clone its entries", () => {
    const input = Object.freeze(entries(26).map((entry) => Object.freeze(entry)));
    const original = [...input];
    for (const featureLatest of [true, false]) {
      const layout = layoutIndex(input, { page: 2, featureLatest });
      expect(layout.posts[0]).toBe(input[featureLatest ? 13 : 12]);
    }
    expect(input).toEqual(original);
  });
});
