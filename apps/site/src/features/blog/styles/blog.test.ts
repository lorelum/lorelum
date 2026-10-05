import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const blogCss = readFileSync(new URL("./blog.css", import.meta.url), "utf8");
const indexScreen = readFileSync(new URL("../blog-index-screen.tsx", import.meta.url), "utf8");
const postScreen = readFileSync(new URL("../blog-post-screen.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../components/blog-surface.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../components/blog-index-controls.tsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../components/blog-sidebar.tsx", import.meta.url), "utf8");
const entryRow = readFileSync(new URL("../components/blog-entry-row.tsx", import.meta.url), "utf8");
const featuredEntry = readFileSync(new URL("../components/blog-featured-entry.tsx", import.meta.url), "utf8");
const cover = readFileSync(new URL("../components/blog-cover.tsx", import.meta.url), "utf8");
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

  test("loads Fumadocs' own base styles once, from the global entry", () => {
    // The name used to say "preserves the global landing Fumadocs theme", which
    // stopped being true when the tokens moved to the document scope: the landing
    // page is on the design system's palette now, and this assertion was never
    // about that — it is about where Fumadocs' base stylesheet is imported.
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
    // The mapping is checked where the bindings live: the whole
    // `--color-fd-*` set is bound once, in `app.css` on the design system's own
    // scope. This assertion used to read the surface stylesheet, back when each
    // surface kept its own copy of the mapping — the duplication this change
    // removed. The six role-to-token pairs are unchanged.
    const mappings = {
      overlay: "overlay",
      info: "info",
      warning: "warning",
      error: "destructive",
      success: "success",
      idea: "primary",
    } as const;

    for (const [fumadocsRole, semanticRole] of Object.entries(mappings)) {
      expect(appCss).toContain(`--color-fd-${fumadocsRole}: var(--${semanticRole});`);
    }
  });
});

describe("blog-local aliases", () => {
  const FROZEN = [
    "--blog-figure-gutter",
    "--blog-hairline",
    "--blog-link",
    "--blog-measure",
    "--blog-quiet-surface",
    "--blog-shell-max",
    "--blog-shell-sidebar",
    "--blog-sticky-offset",
    "--blog-toc-rail",
  ];
  const COLOUR = new Set(["--blog-hairline", "--blog-link", "--blog-quiet-surface"]);

  test("publishes exactly the frozen alias set", () => {
    // A new alias has to update this list and its stated reason, so an
    // unreviewed alias cannot appear quietly.
    //
    // `--blog-figure-gutter` came with the shell too: figures and tables span the
    // middle column, and the space they keep from its edges needed a name.
    //
    // `--blog-shell-sidebar` was added when the editorial shell landed: the
    // left column is the blog's own navigation and needed a width the shell can
    // put in a track list. It is a separate name from `--blog-toc-rail` even
    // though the value matches, because a rule that says "sidebar" should not
    // have to know it is borrowing the rail's width.
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
      "--blog-figure-gutter",
      "--blog-measure",
      "--blog-shell-max",
      "--blog-shell-sidebar",
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

  test("presents index entries as cards, separated by spacing rather than a line", () => {
    // This used to pin a hairline between rows, from when an entry was a row in a
    // sequence rather than a card. Cards are bounded surfaces, so a line between
    // them is wrong on its face: the separation is the gap, and the entry carries
    // the surface and the `panel` radius. The rule it replaced is gone rather than
    // left inert — a dead selector is what the `.blog-page` test above is for.
    expect(blogRules).not.toContain(".blog-entry-list");
    expect(indexScreen).toContain("space-y-");
    expect(entryRow).toContain("bg-[var(--blog-quiet-surface)]");
    expect(entryRow).toContain("rounded-[var(--lore-radius-panel)]");
    // The whole card is clickable while the title stays the only interactive
    // element: the link stretches over it instead of the card becoming a link.
    expect(entryRow).toContain("after:absolute after:inset-0");
    // The title sits at the title role's weight: on the latin side the display
    // face already carries the hierarchy, but the zh heading falls back to the
    // reading face (no CJK glyphs in the display face), where this weight step
    // is the only contrast the title has.
    expect(entryRow).toContain("text-xl font-semibold");
  });

  test("gives the index an editorial hierarchy without adding a second headline", () => {
    expect(indexScreen).toContain('<h1 className="text-sm font-medium text-fd-muted-foreground">');
    expect(entryRow).toContain("md:aspect-square xl:w-60");
    expect(entryRow).toContain("lg:text-2xl");
    expect(entryRow.indexOf('<time dateTime={entry.data.date}')).toBeLessThan(
      entryRow.indexOf('<h2 lang={entry.locale}'),
    );
    expect(cover).toContain('fill="var(--lore-brand-deep)"');
    expect(cover).toContain('fill="var(--lore-brand-light)"');
    expect(cover).toContain("rx={1}");
    expect(cover).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(cover).toContain("bg-[var(--lore-brand-deep)] p-5");
  });

  test("lets the first visible story use the index's full reading stage", () => {
    expect(indexScreen).toContain("featured={entry === cardPosts[0]}");
    expect(entryRow).toContain("if (featured) return <BlogFeaturedEntry");
    expect(featuredEntry).toContain("lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]");
    expect(featuredEntry).toContain("xl:text-[length:var(--lore-text-display)]");
    expect(blogRules).toMatch(/\.blog-shell--index\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(controls).toContain('data-blog-controls="category" className="flex flex-wrap gap-1.5"');
  });

  test("keeps the featured cover substantial at intermediate widths", () => {
    expect(featuredEntry).toContain("blog-featured-cover aspect-[8/5] w-full min-w-0");
    expect(featuredEntry).toContain("sm:text-4xl lg:text-5xl");
    expect(featuredEntry).toContain("<BlogCover entry={entry} priority");
  });

  test("separates the brand stage from its complete reading region", () => {
    expect(blogRules).toContain("--blog-quiet-surface: color-mix(in srgb, var(--secondary) 28%, transparent);");
    expect(entryRow).toContain("border border-[var(--blog-hairline)] bg-[var(--blog-quiet-surface)]");
    expect(entryRow).toContain("overflow-hidden rounded-sm ${coverSize}");
    expect(featuredEntry).toContain("bg-[var(--lore-brand-deep)]");
    expect(featuredEntry).toContain("blog-featured-reading");
    expect(featuredEntry).toContain("max-w-[var(--blog-measure)]");
    expect(featuredEntry).not.toContain("rounded-[var(--lore-radius-panel)]");
    expect(featuredEntry).not.toContain("shadow-");
    expect(featuredEntry).not.toContain("line-clamp");
    expect(entryRow).not.toContain("line-clamp");
  });

  test("keeps the quieter sidebar navigation touch-sized", () => {
    expect(sidebarSource).toContain("min-h-[var(--lore-size-touch)]");
    expect(sidebarSource).toContain("text-fd-muted-foreground");
    expect(sidebarSource).not.toContain("border-l");
    expect(controls).toContain("blog-index-toolbar");
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

  test("renders one horizontal discovery toolbar at every index width", () => {
    expect(sidebarSource).not.toContain("<BlogIndexControls");
    expect(indexScreen).not.toContain("<BlogSidebar");
    expect(indexScreen).not.toContain('className="lg:hidden"');
    const controlsIndex = indexScreen.indexOf("<BlogIndexControls");
    const cardsIndex = indexScreen.indexOf('<ul className="mt-6 space-y-4">');
    expect(controlsIndex).toBeGreaterThan(-1);
    expect(indexScreen.match(/<BlogIndexControls\b/g)?.length).toBe(1);
    expect(controlsIndex).toBeLessThan(cardsIndex);
    expect(indexScreen).toContain("lang={lang} posts={posts} category={category} sort={sort} q={q}");
    // Both controls are links carrying the full search state — a category click
    // preserves the ordering, an ordering click preserves the category — so
    // changing either is one plain navigation. The navigation works without
    // JavaScript; the narrowed list does not: a query URL is answered by the
    // prerendered static index, and the filtering renders once scripts run. The
    // spec states this; the earlier "the page arrives filtered with no
    // JavaScript" claim was wrong and is gone. (The ordering was a GET form
    // with a native select until review rejected the select: the select's open
    // popup is platform chrome no stylesheet reaches, so it read as foreign in
    // both themes.)
    expect(controls).toMatch(/<Link[^>]*to=\{blogIndexPath\(lang\)\}/);
    expect(controls).toContain("search={{ category, sort: candidate, q }}");
    expect(controls).toContain("search={{ category: candidate, sort, q }}");
    // The reset link strips both params explicitly: a Link without `search`
    // inherits the current one, which left "reset" pointing at the very state
    // it claims to clear (measured: it landed on `?sort=newest`).
    expect(controls).toContain("search={{ category: undefined, sort: undefined, q: undefined }}");
    expect(controls).toContain('role="search"');
    expect(controls).toContain('method="get"');
    expect(controls).not.toContain("<select");
    // And they are sized as controls rather than as list text: the design
    // system's touch size and the shared focus ring. (The `--input` border role
    // left with the select it dressed; the remaining controls are links, and
    // links take the ring.)
    expect(controls).toContain("var(--lore-size-touch)");
    expect(controls).toContain("var(--ring)");
    expect(controls).toContain('data-blog-controls="sort" className="flex flex-wrap gap-1.5"');
  });

  test("keeps navigation and filter choices complete while restricting cards", () => {
    expect(indexScreen).toContain('<h1 className="text-sm font-medium text-fd-muted-foreground">');
    expect(featuredEntry).toContain("text-3xl font-semibold");
    expect(featuredEntry).toContain("sm:text-4xl lg:text-5xl");
    expect(indexScreen).toContain("filteredPostSlugs?: readonly string[];");
    expect(indexScreen).toContain("posts.filter((entry) => cardSlugs.has(entry.slug))");
    expect(indexScreen).toContain("cardPosts.length === 0");
    expect(indexScreen).toContain("cardPosts.map((entry) =>");
  });

  test("every index card carries cover art, generated when the post has none", () => {
    // The reference indexes (OpenAI's and Claude's) ship no text-only card, and
    // review called the text-only card childish. So the row renders the entry's
    // cover unconditionally, and `BlogCover` — not the author — is what decides
    // between the frontmatter `image` and the generated pattern, which keeps
    // "every card has art" true even for a post with no art of its own.
    expect(entryRow).toContain("<BlogCover");
    expect(cover).toMatch(/entry\.data\.image !== undefined/);
    expect(cover).toMatch(/coverCells\(entry\.slug\)/);
    // The card is the reference's shape — art on one side, text on the other —
    // rather than a text block with a picture nailed on top.
    expect(entryRow).toMatch(/sm:flex-row/);
    // The cover's ratio steps with the layout — 16/9 stacked, 16/10 beside the
    // text at sm, square from md — so crossing 640px changes the composition
    // once less at a stroke.
    expect(entryRow).toContain("sm:aspect-[16/10]");
    expect(entryRow).toContain("md:aspect-square");
  });

  test("calibrates the generated cover's tier strengths per theme", () => {
    // The rects keep the pattern's own opacity as the no-CSS baseline; how
    // strong each tier reads is the adapter's decision, because the baseline
    // band measured ≈1.1:1 against the dark card surface for its lower half —
    // the art read as unrendered rather than quiet. Both themes style all four
    // tiers, dark above light, so each theme carries four perceptible tiers.
    expect(cover).toContain("blog-cover-art");
    expect(cover).toContain("data-tier={coverTierIndex(cell.opacity)}");

    const tierRules = [...blogRules.matchAll(/\[data-tier="([1-4])"\]\s*\{\s*opacity:\s*[\d.]+;/g)];
    expect(tierRules.length).toBe(8); // four tiers × two themes
    expect(blogRules).toMatch(/\.blog-scope \.blog-cover-art \[data-tier="1"\][^}]*opacity:\s*0\.14/);
    expect(blogRules).toMatch(/\.dark \.blog-scope \.blog-cover-art \[data-tier="1"\][^}]*opacity:\s*0\.28/);
    expect(blogRules).toMatch(/\.blog-scope \.blog-cover-art \[data-tier="4"\][^}]*opacity:\s*0\.62/);
    expect(blogRules).toMatch(/\.dark \.blog-scope \.blog-cover-art \[data-tier="4"\][^}]*opacity:\s*0\.78/);
  });
});
