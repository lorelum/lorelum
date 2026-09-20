import { describe, expect, test } from "bun:test";
import { blogCategories } from "../content/frontmatter";
import { categoryLabelKey, isBlogCategory, parseBlogCategory } from "./category-label";

describe("categoryLabelKey", () => {
  test("maps every category to a distinct label key", () => {
    const keys = blogCategories.map(categoryLabelKey);

    expect(keys).toHaveLength(blogCategories.length);
    expect(new Set(keys).size).toBe(blogCategories.length);
  });

  test("never returns the raw enum value as the label", () => {
    for (const category of blogCategories) {
      expect(categoryLabelKey(category)).not.toBe(category);
    }
  });
});

describe("isBlogCategory", () => {
  test("accepts exactly the declared categories", () => {
    for (const category of blogCategories) {
      expect(isBlogCategory(category)).toBe(true);
    }
    expect(isBlogCategory("benchmarks")).toBe(false);
    expect(isBlogCategory("")).toBe(false);
    expect(isBlogCategory(undefined)).toBe(false);
    expect(isBlogCategory(7)).toBe(false);
  });
});

describe("parseBlogCategory", () => {
  test("passes known categories through", () => {
    expect(parseBlogCategory("packs")).toBe("packs");
  });

  test("treats everything else as no filter rather than an error", () => {
    // A repeated search param arrives as an array; a stale link as a string
    // that is no longer a category. Both mean "show the whole index".
    expect(parseBlogCategory(undefined)).toBeUndefined();
    expect(parseBlogCategory("")).toBeUndefined();
    expect(parseBlogCategory("bogus")).toBeUndefined();
    expect(parseBlogCategory(["packs"])).toBeUndefined();
    expect(parseBlogCategory(["packs", "lorelum"])).toBeUndefined();
  });
});
