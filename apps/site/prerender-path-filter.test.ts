import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { shouldPrerenderPage } from "./prerender-path-filter";

const viteConfig = readFileSync(new URL("./vite.config.ts", import.meta.url), "utf8");

describe("prerender path filter", () => {
  test("keeps canonical routes and skips query-state variants", () => {
    expect(shouldPrerenderPage({ path: "/blog/" })).toBe(true);
    expect(shouldPrerenderPage({ path: "/blog/?category=benchmark" })).toBe(false);
    expect(shouldPrerenderPage({ path: "/zh/blog/?sort=title-desc" })).toBe(false);
  });

  test("wires the tested predicate into the Vite config", () => {
    expect(viteConfig).toContain("filter: shouldPrerenderPage");
  });
});