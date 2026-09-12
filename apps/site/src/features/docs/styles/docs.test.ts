import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const docsCss = readFileSync(new URL("./docs.css", import.meta.url), "utf8");
const docsScreen = readFileSync(new URL("../docs-screen.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../../../styles/app.css", import.meta.url), "utf8");

describe("docs style adapter", () => {
  test("loads scoped design tokens only from the Docs feature", () => {
    expect(docsScreen).toContain('import "./styles/docs.css";');
    expect(docsScreen).toContain('containerProps={{ className: "lorelum-ui" }}');
    expect(docsCss).toContain('@import "@lorelum/ui/tokens.css";');
    expect(docsCss).toContain("#nd-docs-layout {");
    expect(docsCss).not.toContain(":root");
  });

  test("preserves the legacy Landing's global Fumadocs theme", () => {
    expect(appCss).toContain('@import "fumadocs-ui/css/neutral.css";');
    expect(appCss).not.toContain('@import "@lorelum/ui/globals.css";');
    expect(appCss).not.toContain('@import "fumadocs-ui/css/shadcn.css";');
  });

  test("keeps numbered Fumadocs steps visually distinct", () => {
    expect(docsCss).toContain("#nd-page .fd-steps {");
    expect(docsCss).toContain("gap: var(--lore-space-inline);");
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
      expect(docsCss).toContain(`--color-fd-${fumadocsRole}: var(--${semanticRole});`);
    }
  });
});
