import { describe, expect, test } from "bun:test";
import { pickFrontmatter } from "./pick-frontmatter";

const frontmatter = {
  title: "Measuring Practice injection",
  description: "A three-condition comparison with per-dimension scoring.",
  date: "2026-03-04",
  category: "benchmark" as const,
  author: "Starduet",
  draft: false,
};

/** The projection must preserve the author's draft flag for every visibility consumer. */
describe("pickFrontmatter", () => {
  test("keeps the author's draft flag rather than answering it", () => {
    expect(pickFrontmatter({ ...frontmatter, draft: true }).draft).toBe(true);
    expect(pickFrontmatter({ ...frontmatter, draft: false }).draft).toBe(false);
  });

  test("preserves authored fields without leaking collection helpers into the route payload", () => {
    const pageData = {
      ...frontmatter,
      image: "/blog/covers/practice-injection.svg",
      updated: "2026-03-06",
      getText: () => "raw source",
    };
    expect(pickFrontmatter(pageData)).toEqual({
      ...frontmatter,
      image: pageData.image,
      updated: pageData.updated,
    });
  });
});
