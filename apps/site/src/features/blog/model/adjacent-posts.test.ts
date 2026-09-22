import { describe, expect, test } from "bun:test";
import type { BlogFrontmatter } from "../content/frontmatter";
import type { BlogIndexEntry } from "./list-posts";
import { adjacentPosts } from "./adjacent-posts";

const entry = (slug: string, date: string): BlogIndexEntry => ({
  slug,
  locale: "en",
  data: {
    title: slug,
    description: `${slug} description`,
    date,
    category: "benchmark",
    author: "Lorelum",
    draft: false,
  } satisfies BlogFrontmatter,
});

describe("adjacentPosts", () => {
  // The index is date-descending, so index 1 is older than index 0.
  const newest = entry("newest", "2026-09-20");
  const middle = entry("middle", "2026-09-10");
  const oldest = entry("oldest", "2026-09-01");
  const entries = [newest, middle, oldest];

  test("reads previous as older and next as newer", () => {
    const result = adjacentPosts(entries, "middle");
    expect(result.previous?.slug).toBe("oldest");
    expect(result.next?.slug).toBe("newest");
  });

  test("the newest post has no next", () => {
    expect(adjacentPosts(entries, "newest")).toEqual({ next: undefined, previous: middle });
  });

  test("the oldest post has no previous", () => {
    expect(adjacentPosts(entries, "oldest")).toEqual({ next: middle, previous: undefined });
  });

  test("a slug that is not in the list yields no neighbours", () => {
    // The index a reader came from can legitimately differ from the list this
    // post belongs to (a filter, or a post that only exists in one locale).
    expect(adjacentPosts(entries, "absent")).toEqual({});
  });

  test("a single-entry index has no neighbours", () => {
    expect(adjacentPosts([newest], "newest")).toEqual({ next: undefined, previous: undefined });
  });
});
