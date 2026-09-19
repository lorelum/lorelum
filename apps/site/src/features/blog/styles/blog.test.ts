import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const blogCss = readFileSync(new URL("./blog.css", import.meta.url), "utf8");
const postScreen = readFileSync(new URL("../blog-post-screen.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../../../styles/app.css", import.meta.url), "utf8");

describe("blog style adapter", () => {
  test("loads scoped design tokens only inside the blog reading scope", () => {
    expect(postScreen).toContain('import "./styles/blog.css";');
    expect(postScreen).toContain("blog-scope");
    expect(blogCss).toContain('@import "@lorelum/ui/tokens.css";');
    expect(blogCss).toContain(".blog-scope {");
    expect(blogCss).not.toContain(":root");
  });

  test("preserves the global landing Fumadocs theme", () => {
    expect(appCss).toContain('@import "fumadocs-ui/css/neutral.css";');
    expect(blogCss).not.toContain('@import "fumadocs-ui/css/neutral.css";');
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
