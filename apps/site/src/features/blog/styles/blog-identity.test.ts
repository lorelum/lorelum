import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The blog is the site's third surface: it inherits the site's chrome, tokens
 * and type scale, and inherits none of the landing page's presentation
 * vocabulary. The landing surface is allowed to use kinetic, decorative and
 * colour-run devices because it is composed for an animated hero; a reading
 * plane is not, and a decorative layer sweeping the reading column is exactly
 * the failure mode this guards.
 *
 * Test files are excluded because they necessarily name what they forbid.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function blogSources(dir = ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...blogSources(path));
    } else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const SOURCES = blogSources().map((path) => ({
  path: path.slice(ROOT.length).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

describe("blog identity", () => {
  test("finds the blog sources to scan", () => {
    expect(SOURCES.length).toBeGreaterThan(8);
  });

  test("uses no landing-page presentation device", () => {
    const banned = [
      "PageBackground",
      "ParticleField",
      "HeroAurora",
      "Antigravity",
      "SpotlightCard",
      "ScrollParallax",
      "SplitTextReveal",
      "CountUp",
      "landing-gradient-text",
      "landing-badge-dot",
      "TintedIcon",
      "--color-run",
    ];

    for (const { path, text } of SOURCES) {
      for (const word of banned) {
        expect(text.includes(word), `${path} references ${word}`).toBe(false);
      }
    }
  });

  test("imports shared chrome and nothing else from the landing surface", () => {
    // Matched on module basenames, which are kebab-case files.
    const ALLOWED = ["landing-navbar", "site-footer"];

    for (const { path, text } of SOURCES) {
      for (const match of text.matchAll(
        /from "@\/(?:features\/landing|components\/landing)\/([^"]+)"/g,
      )) {
        const imported = (match[1] ?? "").split("/").pop() ?? "";
        expect(
          ALLOWED.some((allowed) => imported.includes(allowed)),
          `${path} imports landing module ${match[1]}`,
        ).toBe(true);
      }
    }
  });

  test("uses no Tailwind palette hue", () => {
    // A raw palette colour is a second decorative system beside the production
    // semantic tokens; this surface must compose tokens only.
    const palette =
      /(?:bg|text|border|from|via|to|ring|divide|outline|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/;

    for (const { path, text } of SOURCES) {
      expect(palette.test(text), `${path} uses a palette hue`).toBe(false);
    }
  });

  test("keeps the landing page's eyebrow idiom out", () => {
    // `uppercase` does nothing for CJK text and `tracking-[…]` is the landing
    // surface's label idiom; neither belongs on a reading surface. The index
    // category navigation is toolbar chrome, approved (task 14.7) to render
    // its Latin labels uppercase in the mono face; nothing else may.
    const categoryNav = "components/blog-index-controls.tsx";
    for (const { path, text } of SOURCES) {
      const reading = path.endsWith(categoryNav)
        ? text.replace(/const categoryLinkClass =\s*"[^"]*";/, "")
        : text;
      expect(/\buppercase\b/.test(reading), `${path} uses uppercase`).toBe(false);
      expect(text.includes("tracking-["), `${path} uses a tracking utility`).toBe(false);
    }
  });

  test("carries no reduced-motion handling", () => {
    for (const { path, text } of SOURCES) {
      expect(text.includes("motion-reduce:"), `${path} uses motion-reduce:`).toBe(false);
      expect(text.includes("prefers-reduced-motion"), `${path} uses a reduced-motion query`).toBe(
        false,
      );
    }
  });

  test("puts no group-hover on the reading plane", () => {
    // Row-level hover on a list of reading material is the hover idiom this
    // surface rejects: the title link is the only interactive element.
    for (const { path, text } of SOURCES) {
      expect(text.includes("group-hover"), `${path} uses group-hover`).toBe(false);
    }
  });
});
