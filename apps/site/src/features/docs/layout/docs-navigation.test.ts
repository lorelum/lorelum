import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const baseOptions = readFileSync(new URL("./base-options.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("./docs-brand.tsx", import.meta.url), "utf8");
const banner = readFileSync(new URL("./docs-blog-banner.tsx", import.meta.url), "utf8");

describe("docs chrome current-location rule", () => {
  test("the brand is rendered through the title slot, not handed to fumadocs as a node", () => {
    // `nav.title` accepts a component. As a node, fumadocs wraps it in its own
    // link, whose prefix matching announced the brand as the current page on
    // every `/zh/docs/**` page (measured: two brand links per page, header and
    // sidebar) and tinted the sidebar one through `docs.css`.
    expect(baseOptions).toContain("title: DocsBrand");
    expect(baseOptions).not.toContain("title: <BrandLockup />");
  });

  test("the brand link matches its own path exactly", () => {
    expect(brand).toContain("activeOptions={{ exact: true }}");
    expect(brand).toContain("BrandLockup");
    // The href comes from fumadocs' title slot (`title({href: nav.url, …})`),
    // so dropping the passthrough would silently send the ZH brand to the EN
    // home. Pin it: the link must use the href it is handed.
    expect(brand).toContain("to={href");
  });

  test("the sidebar blog entry uses the destination rule, not the URL spelling", () => {
    // The whole assignment is pinned, not just the function name: a call site
    // that negated the rule would otherwise read as correct here.
    expect(banner).toContain(
      'const isCurrent = isCurrentDestination(pathname, "blog", i18n.languages);',
    );
    expect(banner).toContain('isCurrent ? "page" : undefined');
    expect(banner).not.toContain("!isCurrentDestination");
    // The target's arguments are pinned as a whole call: swapping them sends the ZH
    // docs sidebar to the EN blog (`destinationPath("blog", "en", "en")` →
    // `/en/blog`) while every other assertion here stays satisfied — a mutation the
    // round-4 review passed.
    expect(banner).toContain('to={destinationPath("blog", locale, i18n.defaultLanguage)}');
    // And the pinned expression is only as good as its input: a constant `pathname`
    // makes the banner claim the current page everywhere.
    expect(banner).toMatch(/const \{\s*pathname\s*\} = useLocation\(\)/);
  });
});
