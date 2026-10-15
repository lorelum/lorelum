import { describe, expect, test } from "bun:test";
import { pickFrontmatter } from "./pick-frontmatter";

const frontmatter = {
  title: "Measuring Practice injection",
  description: "A three-condition comparison with per-dimension scoring.",
  date: "2026-03-04",
  category: "benchmark" as const,
  author: "Starduet",
};

/** The projection must preserve the author's draft flag for every visibility consumer. */
describe("pickFrontmatter", () => {
  test("keeps the author's draft flag rather than answering it", () => {
    expect(pickFrontmatter({ ...frontmatter, draft: true }).draft).toBe(true);
    expect(pickFrontmatter({ ...frontmatter, draft: false }).draft).toBe(false);
  });

  test("defaults an absent draft flag to false", () => {
    expect(pickFrontmatter(frontmatter).draft).toBe(false);
  });

  test("projects the payload instead of passing it through", () => {
    const projected = pickFrontmatter({ ...frontmatter, getText: () => "raw source" });
    expect(projected).not.toHaveProperty("getText");
    expect(projected).toEqual({ ...frontmatter, draft: false });
  });

  test("rejects frontmatter that drifts from the contract", () => {
    expect(() => pickFrontmatter({ ...frontmatter, updated: "2026-01-01" })).toThrow();
    expect(() => pickFrontmatter({ ...frontmatter, title: "" })).toThrow();
    expect(() => pickFrontmatter({ ...frontmatter, category: "notes" })).toThrow();
    // A non-boolean `draft` must fail the build-time check rather than be coerced:
    // a `.catch(false)` rewrite would turn a frontmatter mistake into silently
    // publishing the draft instead.
    expect(() => pickFrontmatter({ ...frontmatter, draft: "yes" })).toThrow();
    expect(() => pickFrontmatter({ ...frontmatter, draft: 1 })).toThrow();
    expect(() => pickFrontmatter({ ...frontmatter, draft: null })).toThrow();
  });
});
