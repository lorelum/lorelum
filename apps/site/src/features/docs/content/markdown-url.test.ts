import { describe, expect, test } from "bun:test";
import { decodeMarkdownUrl, encodeMarkdownUrl } from "./markdown-url";

describe("encodeMarkdownUrl", () => {
  test("appends .md to the last slug under /docs", () => {
    expect(encodeMarkdownUrl(["quickstart"])).toBe("/docs/quickstart.md");
    expect(encodeMarkdownUrl(["practices", "verification"])).toBe(
      "/docs/practices/verification.md",
    );
  });

  test("uses index.md for an empty slug list", () => {
    expect(encodeMarkdownUrl([])).toBe("/docs/index.md");
  });

  test("prefixes the locale when given", () => {
    expect(encodeMarkdownUrl(["quickstart"], "zh")).toBe("/zh/docs/quickstart.md");
    expect(encodeMarkdownUrl([], "zh")).toBe("/zh/docs/index.md");
  });
});

describe("decodeMarkdownUrl", () => {
  test("strips .md from the last segment", () => {
    expect(decodeMarkdownUrl(["quickstart.md"])).toEqual(["quickstart"]);
    expect(decodeMarkdownUrl(["practices", "verification.md"])).toEqual([
      "practices",
      "verification",
    ]);
  });

  test("maps the index page to an empty slug list", () => {
    expect(decodeMarkdownUrl(["index.md"])).toEqual([]);
    expect(decodeMarkdownUrl(["index"])).toEqual([]);
  });

  test("passes plain slugs through unchanged", () => {
    expect(decodeMarkdownUrl(["quickstart"])).toEqual(["quickstart"]);
    expect(decodeMarkdownUrl([])).toEqual([]);
  });
});
