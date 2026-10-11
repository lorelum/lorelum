import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Wiring guards for the navbar's compact state.
 *
 * This is a source-shape test, and it is worth saying what that means: the site
 * has no DOM environment, so nothing here proves the morph runs — it proves the
 * pieces are connected, which is the specific way this broke. The first version
 * passed a `RefObject` and the nav read `.current` when its effect ran, before the
 * suspended article body had mounted its masthead, so the trigger was `null` and
 * no morph was ever created (measured: the panel stayed 1425px and square however
 * far the page scrolled). The runtime behaviour is measured in the browser and
 * recorded in the change's evidence, not here.
 */
const hook = readFileSync(new URL("./use-landing-navbar-morph.ts", import.meta.url), "utf8");
const navbar = readFileSync(new URL("./landing-navbar.tsx", import.meta.url), "utf8");
const blogSurface = readFileSync(
  new URL("../../blog/components/blog-surface.tsx", import.meta.url),
  "utf8",
);
const postScreen = readFileSync(
  new URL("../../blog/blog-post-screen.tsx", import.meta.url),
  "utf8",
);
const docsScreen = readFileSync(new URL("../../docs/docs-screen.tsx", import.meta.url), "utf8");

describe("the navbar's compact state is wired for surfaces without a hero", () => {
  test("the hook measures the hero when there is one, and the passed element otherwise", () => {
    expect(hook).toContain("const measured = hero ?? collapseTrigger ?? null;");
    expect(hook).toContain("trigger: measured,");
    // A ref would be read once at mount; the element is what makes the effect
    // re-run when the masthead appears.
    expect(hook).not.toContain("collapseTrigger?.current");
    expect(hook).toContain("collapseTrigger?: HTMLElement | null");
  });

  test("the navbar forwards it, and the blog surface supplies it", () => {
    expect(navbar).toContain("collapseTrigger?: HTMLElement | null;");
    expect(navbar).toContain("useLandingNavbarMorph(navRef, heroId, collapseTrigger);");
    expect(blogSurface).toContain("collapseTrigger={collapseTrigger}");
    // The article hands over its masthead through state, because the masthead
    // arrives with the suspended body.
    expect(postScreen).toContain(
      "const [masthead, setMasthead] = useState<HTMLElement | null>(null);",
    );
    expect(postScreen).toContain("ref={onMasthead}");
    expect(postScreen).toContain("collapseTrigger={masthead}");
  });

  test("the docs surface keeps the full-width navbar", () => {
    // Deliberate: this change is about the blog. If docs ever wants the compact
    // state, this assertion is where the decision is recorded.
    expect(docsScreen).not.toContain("collapseTrigger");
  });
});
