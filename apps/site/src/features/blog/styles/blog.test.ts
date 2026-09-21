import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const blogCss = readFileSync(new URL("./blog.css", import.meta.url), "utf8");
const indexScreen = readFileSync(new URL("../blog-index-screen.tsx", import.meta.url), "utf8");
const postScreen = readFileSync(new URL("../blog-post-screen.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../components/blog-surface.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../../../styles/app.css", import.meta.url), "utf8");

/** Comments carry prose about tokens and class names; rules are what count. */
function rulesOnly(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const blogRules = rulesOnly(blogCss);

/** Every `--blog-*` declaration in the adapter, as name/value pairs. */
function blogAliasDeclarations(css: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const match of rulesOnly(css).matchAll(/(--blog-[a-z-]+)\s*:\s*([^;}]+)/g)) {
    out.push({ name: match[1] ?? "", value: (match[2] ?? "").trim() });
  }
  return out;
}

describe("blog style adapter", () => {
  test("loads scoped design tokens only inside the blog reading scope", () => {
    expect(postScreen).toContain('import "./styles/blog.css";');
    expect(postScreen).toContain("blog-scope");
    expect(indexScreen).toContain('import "./styles/blog.css";');
    expect(blogCss).toContain('@import "@lorelum/ui/tokens.css";');
    expect(blogCss).toContain(".blog-scope {");
    expect(blogCss).not.toContain(":root");
  });

  test("preserves the global landing Fumadocs theme", () => {
    expect(appCss).toContain('@import "fumadocs-ui/css/neutral.css";');
    expect(blogCss).not.toContain('@import "fumadocs-ui/css/neutral.css";');
  });

  test("applies the production token scope on every blog surface", () => {
    // The scope lives in the shared surface component; the invariant is that
    // whichever element wraps a blog screen's reading column carries it, and
    // that neither screen renders an unscoped column of its own. Both screens
    // now route through the surface, so the second half is asserted at its home.
    expect(surface).toContain("lorelum-ui blog-scope");
    expect(indexScreen).toContain("BlogSurface");
    expect(postScreen).toContain("BlogSurface");
    expect(postScreen).not.toContain("lorelum-ui blog-scope");
  });

  test("binds the body font as a property rather than rebinding --font-sans", () => {
    // Rebinding `--font-sans` here would be inert: the site's html font-family
    // resolves that variable at the document root, so this scope must set the
    // font-family property itself.
    expect(blogCss).toContain("font-family: var(--lore-font-sans);");
    expect(blogCss).not.toContain("--font-sans:");
  });

  test("drives the sticky offset from one token for rail and headings alike", () => {
    expect(blogCss).toContain("--blog-sticky-offset:");

    // Every heading level is covered, so no heading keeps Fumadocs' own offset.
    const headingRules = [...blogRules.matchAll(/:is\(([^)]*)\)\s*\{([^}]*)\}/g)].filter((m) =>
      /scroll-margin-top:\s*var\(--blog-sticky-offset\)/.test(m[2] ?? ""),
    );
    const covered = new Set(
      headingRules.flatMap((rule) =>
        (rule[1] ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter((part) => /^h[1-6]$/.test(part)),
      ),
    );
    expect([...covered].sort()).toEqual(["h1", "h2", "h3", "h4", "h5", "h6"]);

    expect(postScreen).toContain("top-[var(--blog-sticky-offset)]");
    // Fumadocs emits its own offset utilities; neither may survive the rebind.
    expect(postScreen).not.toContain("top-20");
  });

  test("keeps every blog colour on a production token", () => {
    expect(blogCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  test("introduces no reduced-motion handling", () => {
    // apps/site/AGENTS.md records the product decision not to use
    // prefers-reduced-motion; this guards it against arriving via the blog.
    expect(blogCss).not.toContain("prefers-reduced-motion");
    expect(indexScreen).not.toContain("prefers-reduced-motion");
    expect(postScreen).not.toContain("prefers-reduced-motion");
  });

  test("maps every Fumadocs feedback role to a production semantic token", () => {
    const mappings = {
      overlay: "overlay",
      info: "info",
      warning: "warning",
      error: "destructive",
      success: "success",
      idea: "primary",
    } as const;

    for (const [fumadocsRole, semanticRole] of Object.entries(mappings)) {
      expect(blogCss).toContain(`--color-fd-${fumadocsRole}: var(--${semanticRole});`);
    }
  });
});

describe("blog-local aliases", () => {
  const FROZEN = [
    "--blog-hairline",
    "--blog-link",
    "--blog-quiet-surface",
    "--blog-sticky-offset",
    "--blog-toc-rail",
  ];
  const COLOUR = new Set(["--blog-hairline", "--blog-link", "--blog-quiet-surface"]);

  test("publishes exactly the frozen alias set", () => {
    // A new alias has to update this list and its stated reason, so an
    // unreviewed alias cannot appear quietly.
    const declared = [...new Set(blogAliasDeclarations(blogCss).map((d) => d.name))].sort();
    expect(declared).toEqual(FROZEN);
  });

  test("builds every colour alias out of production tokens", () => {
    const colourDeclarations = blogAliasDeclarations(blogCss).filter((d) => COLOUR.has(d.name));
    expect(colourDeclarations.length).toBeGreaterThan(0);

    for (const { name, value } of colourDeclarations) {
      const isComposition =
        /^var\(--[a-z-]+\)$/.test(value) ||
        /^color-mix\(in srgb, var\(--[a-z-]+\) \d+%, transparent\)$/.test(value);
      expect(isComposition, `${name}: ${value}`).toBe(true);
    }
  });

  test("states size aliases as unit-bearing lengths", () => {
    const sizeDeclarations = blogAliasDeclarations(blogCss).filter((d) => !COLOUR.has(d.name));
    expect(sizeDeclarations.map((d) => d.name).sort()).toEqual([
      "--blog-sticky-offset",
      "--blog-toc-rail",
    ]);

    for (const { name, value } of sizeDeclarations) {
      expect(value, `${name}: ${value}`).toMatch(/^\d+(\.\d+)?(rem|px|ch|em)$/);
    }
  });

  test("overrides the theme-asymmetric link token in dark mode", () => {
    // `--accent-foreground` is brand green in light and neutral in dark, so
    // without the dark override the "links are green" signal disappears.
    expect(blogCss).toContain(".dark .blog-scope {");
    const darkBlock = blogCss.slice(blogCss.indexOf(".dark .blog-scope {"));
    expect(darkBlock).toMatch(/--blog-link:\s*var\(--primary\)/);
  });
});

describe("blog typography contract", () => {
  test("gives headings the display face", () => {
    // The article's h2/h3 previously fell through to the body face because the
    // only heading rule lived in the docs chunk, which blog pages never load.
    expect(blogRules).toMatch(
      /:is\(h1, h2, h3, h4\)\s*\{[^}]*font-family:\s*var\(--lore-font-display\)/,
    );
    expect(blogRules).toContain("text-wrap: balance");
  });

  test("hands chinese headings back to the reading face", () => {
    // The display face has no CJK coverage; without this, a Chinese heading
    // mixes Bricolage latin glyphs with system Chinese ones.
    expect(blogRules).toMatch(/:lang\(zh\)\s*\{[^}]*font-family:\s*var\(--lore-font-sans\)/);
    expect(blogRules).toMatch(/:lang\(zh\)\s*\{[^}]*letter-spacing:\s*0/);
  });

  test("loosens chinese body leading from the shared multiplier", () => {
    expect(blogRules).toMatch(
      /:lang\(zh\)\s*\{[^}]*line-height:\s*calc\(var\(--lore-leading-body\) \* 1\.08\)/,
    );
  });

  test("rebinds every prose role the blog renders", () => {
    // These roles resolve through `--color-fd-*` by default; each one the blog
    // can render is rebound to a production token.
    const bindings = {
      links: "--blog-link",
      bullets: "--border-strong",
      hr: "--blog-hairline",
      "quote-borders": "--border-strong",
      code: "--code-foreground",
      captions: "--muted-foreground",
      "th-borders": "--blog-hairline",
      "td-borders": "--blog-hairline",
    };

    for (const [role, token] of Object.entries(bindings)) {
      expect(blogRules).toContain(`--tw-prose-${role}: var(${token});`);
    }
  });

  test("sets the reading column to the production body metrics", () => {
    // The binding sets the base the `:lang(zh)` multiplier scales. Without it
    // the base is Fumadocs' own 28px rather than the token's 26px.
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__reading \.prose\s*\{[^}]*font-size:\s*var\(--lore-text-body\)/,
    );
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__reading \.prose\s*\{[^}]*line-height:\s*var\(--lore-leading-body\)/,
    );
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__reading \.prose\s*\{[^}]*font-family:\s*var\(--lore-font-sans\)/,
    );
  });

  test("keeps every prose rule off the table-of-contents entries", () => {
    // Fumadocs' TOC entries are themselves `.prose` elements
    // (`prose relative py-1.5 text-sm`). A rule scoped to `.prose` alone
    // therefore also lands on them, overriding the 14px/20px their `text-sm`
    // asks for. `article` was too broad in the same way once the
    // narrow-viewport disclosure started rendering those entries inside it —
    // they measured 16px/26px again. `.blog-post__reading` wraps the prose body
    // and nothing else.
    //
    // The selector list is split on commas before matching and each part is
    // anchored, because a rule may append a second, unscoped selector to a
    // scoped one — `.blog-scope .blog-post__reading .prose, .blog-scope .prose
    // { … }` — which re-broadens the rule while every part still contains the
    // scoped text somewhere.
    const selectors = [...blogRules.matchAll(/([^{}]*)\{/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.includes(".prose"));

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^\.blog-scope \.blog-post__reading \.prose\b/);
    }
  });

  test("does not italicise quotes", () => {
    // Fumadocs ships `font-style: italic` on blockquotes; for Chinese that
    // italic is synthesised.
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__reading \.prose blockquote:not\(\[class~="not-prose"\]\)\s*\{[^}]*font-style:\s*normal/,
    );
  });

  test("gives tables the production radius, not Tailwind's default", () => {
    // `--radius-lg` is Tailwind's default-theme 0.5rem here — the site never
    // loads `theme.css` — so Fumadocs' table radius missed the production one.
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__reading \.prose\s*\{[^}]*--radius-lg:\s*var\(--radius\)/,
    );
  });

  test("keeps the language rules inside the blog scope", () => {
    // The navbar and footer are shared chrome; a loose `:lang(zh)` rule would
    // restyle them on blog routes only.
    for (const match of blogRules.matchAll(/([^{}]*:lang\(zh\)[^{}]*)\{/g)) {
      expect((match[1] ?? "").trim().startsWith(".blog-scope"), match[1] ?? "").toBe(true);
    }
  });

  test("wraps an unbreakable run anywhere in the blog scope, not only in headings", () => {
    // Measured on the built site with a 105-character token as the article title:
    // the h1 overflowed its 664px column by 643px and the page scrolled
    // horizontally by 627px at 375px (263px at 768, 135px at 1024), and the index
    // row title overflowed by 58px even at 1440px. A first fix covered headings and
    // the reading column's paragraphs only; the round-4 review then put the same
    // token in the other author-filled roles and measured what that left open at
    // 375px: 292px of page scroll from the dek, 151px from the author, 221px from
    // an index row summary, 158px from a neighbour title. So the contract is the
    // scope, and `overflow-wrap` inherits from there into every one of those roles.
    expect(blogRules).toMatch(/\.blog-scope\s*\{[^}]*overflow-wrap:\s*break-word/);
    // The flex rows still need it on their items: a flex item will not shrink below
    // the width of an unbreakable run without `min-width: 0`.
    expect(blogRules).toMatch(
      /\.blog-scope :is\(h1, h2, h3, h4, h5, h6\) > \*,[^}]*\.blog-scope \.blog-post__meta > \*[^{]*\{[^}]*min-width:\s*0/,
    );
    // The closing block's neighbour row is the third case, and the one where
    // neither rule above helps: the link is an `inline-flex` box, so it is floored
    // at its min-content width whatever its children do (measured: 502px inside a
    // 328px column at 375px, i.e. 158px of page scroll, unaffected by `min-width: 0`
    // on the children and removed by this cap).
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__closing \.blog-nav-link\s*\{[^}]*max-width:\s*100%/,
    );
    // A later rule that keeps both pinned declarations and resets them re-opens the
    // defect while the assertions above still match (the round-4 review verified
    // that mutation passing), so every reset spelling of both properties is
    // forbidden outright — `initial`/`unset`/`revert` included, because they are
    // the same reset wearing a different word.
    expect(blogRules).not.toMatch(/overflow-wrap:\s*(normal|initial|unset|revert)/);
    expect(blogRules).not.toMatch(/(?:min|max)-width:\s*(auto|none|initial|unset|revert)/);
  });
});

describe("blog link contract", () => {
  test("underlines body links permanently and nav links only on hover", () => {
    expect(blogRules).toMatch(
      /\.blog-scope \.blog-post__reading \.prose a:not\(\[data-card\]\)\s*\{[^}]*text-decoration-line:\s*underline/,
    );
    expect(blogRules).toMatch(
      /:is\(\.blog-title-link, \.blog-nav-link\)\s*\{[^}]*text-decoration-line:\s*none/,
    );
    expect(blogRules).toMatch(
      /:is\(\.blog-title-link, \.blog-nav-link\):hover\s*\{[^}]*color:\s*var\(--blog-link\)/,
    );
  });

  test("dims no link and fades the underline instead", () => {
    // Fumadocs' own hover rule drops the whole link to 80% opacity. The
    // override must both restore the opacity and animate the decoration
    // colour, not the opacity — so both are asserted inside the link rules.
    const restingRule = blogRules.match(
      /\.blog-scope \.blog-post__reading \.prose a:not\(\[data-card\]\)\s*\{([^}]*)\}/,
    );
    expect(restingRule, "the body-link rule").not.toBeNull();
    expect(restingRule?.[1] ?? "").toContain("transition-property: color, text-decoration-color;");
    expect(restingRule?.[1] ?? "").toContain("transition-duration: var(--lore-motion-feedback);");

    const hoverRule = blogRules.match(
      /\.blog-scope \.blog-post__reading \.prose a:not\(\[data-card\]\):hover\s*\{([^}]*)\}/,
    );
    expect(hoverRule, "the body-link hover rule").not.toBeNull();
    expect(hoverRule?.[1] ?? "").toContain("opacity: 1;");
    expect(hoverRule?.[1] ?? "").toContain("text-decoration-color: var(--blog-link);");
  });

  test("takes focus from the focus token", () => {
    expect(blogRules).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/);
  });

  test("separates index rows with the inline hairline, not a structural border", () => {
    expect(blogRules).toMatch(
      /\.blog-entry-list > li \+ li\s*\{[^}]*border-top:\s*1px solid var\(--blog-hairline\)/,
    );
  });
});

describe("blog index structure", () => {
  test("links each entry to its own locale's URL", () => {
    // The regression for a single-locale post: an href built from the page's
    // language pointed readers of the other language at a slug that does not
    // exist there.
    const row = readFileSync(new URL("../components/blog-entry-row.tsx", import.meta.url), "utf8");
    expect(row).toContain("blogPostPath(entry.locale, entry.slug)");
    expect(indexScreen).not.toContain("translatedMarker");
  });

  test("drops the dead .blog-page class", () => {
    // It had no CSS rule and no consumer anywhere in the repo.
    expect(indexScreen).not.toContain("blog-page");
    expect(postScreen).not.toContain("blog-page");
    expect(blogRules).not.toContain(".blog-page");
  });

  test("renders no filter chrome until a filter is active", () => {
    // The filter row is conditional; a permanently visible filter bar is a
    // control that occupies the page while doing nothing.
    expect(indexScreen).toMatch(/category === undefined \? null :/);
  });
});
