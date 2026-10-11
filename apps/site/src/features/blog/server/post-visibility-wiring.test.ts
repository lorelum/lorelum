import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The wiring around the visibility rule, not the rule itself: which environment
 * each of the three call sites hands to `isPostVisible`.
 *
 * The stage-4 review walked the rule and its callers and found that the unit suite
 * did not notice five changes to the wiring — the index's environment, the
 * sitemap's fixed environment, the post loader's environment, `isDevelopment`
 * becoming optional with a default, and a caller going back to an inline draft
 * check. All five change what a reader sees (the first three change it in
 * production as well), so they are pinned here. Its later rounds then showed the
 * pins were weaker than they looked: a value written as `import.meta.env.DEV ||
 * true` matched, because the value was matched by prefix; and a call that passed
 * the right value and then a second `isDevelopment: true` matched too, because
 * only the first `isDevelopment` in the call body was read — in an object literal
 * the later key wins, so that spelling published a draft in a production build
 * with the suite green. Every `isDevelopment` value in a call is now compared, and
 * an inline draft check in the index source is rejected in the spellings we know.
 *
 * These are source-text assertions, and both sides of that trade are accepted
 * knowingly.
 *
 * The ceiling: a mutation that keeps this text and changes behaviour elsewhere
 * still passes. Its measured instances are recorded in the change's evidence and
 * the PR description; the live ones are a loader gate whose condition never fires,
 * a sitemap check written as `|| draft`, a check moved into another module, and a
 * spread that overrides the argument. The closure for that class is not this file:
 * `post-visibility-behaviour.test.ts` drives the same three functions through a
 * substituted source adapter and holds the answer a reader gets, which needs no DOM
 * and no new dependency. What neither file covers is Fumadocs parsing `draft` out
 * of real MDX — that is `content-contract.test.ts` plus the artifact probes, which
 * run by hand from a gitignored directory and are not a gate.
 *
 * The reverse cost, measured: a caller that hoists the environment into a local
 * const is rejected although it behaves the same, a call named in a trailing
 * comment still counts, and a behaviour-neutral `{ draft }` destructuring added to
 * the index fails the negative below. Comment-only lines are dropped, so prose
 * about the code does not fail the suite.
 *
 * What the rule itself reads has its own behavioural test
 * (`pick-frontmatter.test.ts`), and the rule's own truth table is in
 * `../model/post-visibility.test.ts`.
 */
const source = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join("\n");

const listBlogPosts = source("./list-blog-posts.ts");
const loadBlogPost = source("./load-blog-post.ts");
const publishedPages = source("./published-pages.ts");
const listPostsModel = source("../model/list-posts.ts");

/** Every `isPostVisible({ … })` call body in a file, braces balanced enough for this shape. */
function visibilityCalls(text: string): string[] {
  return [...text.matchAll(/isPostVisible\(\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

/**
 * Every expression a call hands to `isDevelopment`, exactly as written. All of
 * them are read, not just the first: a later key in the same object literal wins
 * at runtime, so a first-match check would accept
 * `{ isDevelopment: import.meta.env.DEV, …{ isDevelopment: true } }` while the
 * engine reads `true`. The value runs to the next `,` or `}`, so a nested object's
 * `isDevelopment` is read too, and a call that passes the shorthand form
 * (`{ isDevelopment }`) yields nothing here — which the caller treats as a failure.
 */
function visibilityValues(call: string): string[] {
  return [...call.matchAll(/isDevelopment\s*:\s*([^,}]*)/g)].map((match) =>
    (match[1] ?? "").trim(),
  );
}

describe("post visibility wiring", () => {
  test("the index is built for the environment the server is running in", () => {
    // The dev index lists drafts because their URL serves there. Passing a fixed
    // `false` (or dropping the argument) silently restores the old inconsistency
    // while every other test in the suite stays green — the stage-4 review proved
    // exactly that mutation passes.
    expect(listBlogPosts).toContain("{ isDevelopment: import.meta.env.DEV }");
    expect(listBlogPosts).toMatch(
      /buildBlogIndex\([\s\S]*?\{\s*isDevelopment:\s*import\.meta\.env\.DEV\s*\}/,
    );
    // The model already answers visibility with the environment, so an inline
    // draft check here would answer it a second time — hiding drafts from the dev
    // index while their URLs still serve (the inconsistency stage-4 task 2.2
    // removed). The spellings below cover the ones a review has tried, including
    // `["draft"]` and a `{ draft }` binding. What text cannot see is a key computed
    // elsewhere, `Reflect.get`, a helper in another module, or an external spread —
    // `post-visibility-behaviour.test.ts` is what holds those. This negative also
    // rejects a behaviour-neutral `{ draft }` destructuring, which is the price of
    // pinning spellings.
    expect(listBlogPosts).not.toMatch(/\.draft/);
    expect(listBlogPosts).not.toMatch(/\[\s*["'`]draft["'`]\s*\]/);
    expect(listBlogPosts).not.toMatch(/\{\s*draft\s*[,}:]/);
  });

  test("the post loader reads the same environment variable, at both call sites", () => {
    const calls = visibilityCalls(loadBlogPost);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const values = visibilityValues(call);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(value).toBe("import.meta.env.DEV");
      }
    }
  });

  test("the sitemap source fixes the environment to production", () => {
    // A sitemap never lists a draft, in any environment. Reading DEV here would
    // put drafts into the published sitemap during development — and there is no
    // unit test that would notice, which is why it is pinned in text.
    const calls = visibilityCalls(publishedPages);
    expect(calls).toHaveLength(1);
    const values = visibilityValues(calls[0]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toBe("false");
    }
    expect(publishedPages).not.toMatch(/![\s\S]{0,40}\.draft/);
  });

  test("the index option is required, so a caller cannot answer it by default", () => {
    expect(listPostsModel).toMatch(/readonly isDevelopment: boolean;/);
    expect(listPostsModel).not.toMatch(/isDevelopment\?:/);
    expect(listPostsModel).toContain("{ isDevelopment }: BlogIndexOptions");
    expect(listPostsModel).not.toMatch(/isDevelopment\s*=\s*(true|false)/);
  });
});
