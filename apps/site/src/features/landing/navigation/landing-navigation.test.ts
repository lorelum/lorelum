import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const navbar = readFileSync(new URL("./landing-navbar.tsx", import.meta.url), "utf8");
const destinations = readFileSync(
  new URL("./landing-primary-navigation.tsx", import.meta.url),
  "utf8",
);

describe("landing navigation current-location rule", () => {
  test("the destination comes from the pathname, not from the link's own href", () => {
    // The href is the canonical unprefixed path (`/blog`) while the reader may be
    // on the prefixed spelling (`/en/blog/...`), so the router's own comparison
    // answered "nowhere" on those pages.
    expect(destinations).toContain("destinationOf(pathname, i18n.languages)");
    expect(destinations).toContain('current === destination ? ("page" as const) : undefined');
  });

  test("every destination link silences the router's prefix matching", () => {
    // `Link` marks a target active by prefix, which said "Home" on `/zh/blog/...`
    // and "Blog" on `/blog/<slug>`. One text-only mark decides instead.
    const exact = destinations.match(/activeOptions=\{\{ exact: true \}\}/g) ?? [];
    expect(exact.length).toBe(3);
    expect(destinations.match(/aria-current=\{mark\(/g)?.length).toBe(3);
  });

  test("the brand link marks only the exact home path", () => {
    // The brand link to `/zh` was marked current on every ZH sub-page (measured
    // in `probe-chrome`): the locale home is a prefix of every prefixed route.
    expect(navbar).toContain("activeOptions={{ exact: true }}");
  });
});
