/**
 * The site's colour surface: the document's `theme-color` pair, and the one place
 * the Fumadocs token names are bound to the design system's tokens.
 *
 * Each assertion here exists because the thing it pins was load-bearing while this
 * change was made, and each failure mode was hit:
 *
 * - `getRootHead` declared a light/dark `theme-color` pair and **only the light one
 *   reached the DOM** on every built page, because `buildTagsFromMatches` in
 *   `@tanstack/react-router` de-duplicates meta tags by `name`. Both tags live in
 *   the document shell now, which is outside that pipeline.
 * - The `--color-fd-*` names used to be re-bound inside `#nd-docs-layout` and
 *   `.blog-scope`, which left `body` — and every margin around a scoped column, and
 *   the shared navbar and footer — on Fumadocs' neutral palette. That is the seam
 *   between the article column and the page.
 * - The design system's tokens belong to a `.lorelum-ui` scope, and the dark set is
 *   `.dark .lorelum-ui` — a **descendant** selector. Putting `lorelum-ui` on `<html>`
 *   beside Fumadocs' `.dark` therefore never matches the dark set, which is why the
 *   document carries the scope on `<body>`.
 * - Those tokens arrived only with the docs and blog CSS chunks, so binding at the
 *   scope was not enough: the landing page loads neither chunk, and with the scope
 *   on `body` and no token values on that route the binding resolved to nothing and
 *   the page painted no background at all. Hence the global import.
 *
 * What this cannot check, stated so it is not mistaken for covered: whether the tags
 * and computed colours actually hold in a built page, at which width, and what the
 * browser paints at each pixel. Those are artifact readings — a probe against
 * `dist/client`, and CDP for the ink — not `bun test` assertions.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const siteFile = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const documentShell = siteFile("./root-document.tsx");
const rootHead = siteFile("./root-head.ts");
const appCss = siteFile("../styles/app.css");
const tokens = siteFile("../../../../packages/ui/src/styles/tokens.css");

const SCOPE = ".lorelum-ui";

/** The production background per scheme, read from the token source. */
const tokenBackground = (scheme: "light" | "dark") => {
  const darkAt = tokens.indexOf(`.dark ${SCOPE}`);
  if (darkAt < 0) throw new Error(`tokens.css no longer has a \`.dark ${SCOPE}\` block`);
  const block = scheme === "light" ? tokens.slice(0, darkAt) : tokens.slice(darkAt);
  const match = /--background:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(block);
  if (!match) throw new Error(`no --background in the ${scheme} block of tokens.css`);
  return match[1].toLowerCase();
};

describe("theme-color", () => {
  test("both schemes are declared, with their media queries, in the document shell", () => {
    const tags = [...documentShell.matchAll(/<meta\s+name="theme-color"[^>]*\/>/g)].map(
      (m) => m[0],
    );
    expect(tags).toHaveLength(2);
    expect(tags.some((tag) => tag.includes('media="(prefers-color-scheme: light)"'))).toBe(true);
    expect(tags.some((tag) => tag.includes('media="(prefers-color-scheme: dark)"'))).toBe(true);
  });

  test("each value is the production background for its scheme, not a Fumadocs default", () => {
    const light = tokenBackground("light");
    const dark = tokenBackground("dark");
    expect(light).not.toBe("#f5f5f5");
    expect(dark).not.toBe("#121212");

    expect(documentShell).toContain(`content="${light}" media="(prefers-color-scheme: light)"`);
    expect(documentShell).toContain(`content="${dark}" media="(prefers-color-scheme: dark)"`);
  });

  test("the route head no longer declares it, because that pipeline de-duplicates by name", () => {
    // The assertion is on the declaration, not on the file's text, so the comment
    // there — which explains the de-duplication — cannot make the suite red.
    expect(rootHead).not.toMatch(/name:\s*"theme-color"/);
  });
});

describe("the Fumadocs token names are bound to the design system once", () => {
  test("app.css imports the token source globally", () => {
    // Not cosmetic: the tokens used to arrive only with the docs and blog chunks.
    // Without this import, `.lorelum-ui` on the landing route binds to nothing.
    expect(appCss).toMatch(/@import\s+"@lorelum\/ui\/tokens\.css";/);
  });

  test("app.css binds the whole set on the design system's scope", () => {
    const scopeAt = appCss.indexOf(`${SCOPE} {`);
    expect(scopeAt).toBeGreaterThan(-1);
    const block = appCss.slice(scopeAt, appCss.indexOf("}", scopeAt));
    const bound = [...block.matchAll(/--color-fd-[a-z-]+:\s*var\(/g)];
    expect(bound.length).toBeGreaterThanOrEqual(20);
    for (const declaration of block.matchAll(/--color-fd-[a-z-]+:\s*([^;]+);/g)) {
      expect(declaration[1]).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });

  test("no other stylesheet re-binds them", () => {
    // Every site stylesheet except the one above, found by walking the tree rather
    // than by naming files: a fourth surface copying the block back would otherwise
    // slip past a hardcoded list.
    const siteRoot = fileURLToPath(new URL("../", import.meta.url));
    const BINDING = "styles/app.css"; // the one place above
    const sheets = readdirSync(siteRoot, { recursive: true })
      .map(String)
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => name.endsWith(".css") && name !== BINDING);

    expect(sheets.length).toBeGreaterThan(4); // the walk is not silently empty
    for (const relative of sheets) {
      const source = readFileSync(`${siteRoot}${relative}`, "utf8");
      // A declaration (as opposed to a use like `color: var(--color-fd-foreground)`)
      // is what would duplicate the binding.
      const declarations = [...source.matchAll(/^\s*--color-fd-[a-z-]+:/gm)];
      expect({ file: relative, declarations: declarations.length }).toMatchObject({
        declarations: 0,
      });
    }
  });
});

describe("the document carries the design system's scope", () => {
  test("on <body>, because the dark token set needs `.dark` on an ancestor", () => {
    expect(documentShell).toMatch(/<body className="lorelum-ui\b/);
    // `<html>` must not carry it: `.dark .lorelum-ui` is a descendant selector and
    // Fumadocs puts `.dark` on `<html>`, so one element could never match both.
    expect(documentShell).not.toMatch(/<html[^>]*className="[^"]*lorelum-ui/);
  });
});
