import { describe, expect, test } from "bun:test";
import { isPostVisible } from "./post-visibility";

describe("post visibility", () => {
  test("a published post is visible everywhere", () => {
    expect(isPostVisible({ draft: false, isDevelopment: false })).toBe(true);
    expect(isPostVisible({ draft: false, isDevelopment: true })).toBe(true);
  });

  test("a draft is visible only in development", () => {
    // The author needs to read the page they are writing; a reader who guesses
    // the slug in production must not.
    expect(isPostVisible({ draft: true, isDevelopment: true })).toBe(true);
    expect(isPostVisible({ draft: true, isDevelopment: false })).toBe(false);
  });
});
