import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const docsCss = readFileSync(new URL("./docs.css", import.meta.url), "utf8");
const docsScreen = readFileSync(new URL("../docs-screen.tsx", import.meta.url), "utf8");

describe("docs style adapter", () => {
  test("loads the docs refinements only from the Docs feature", () => {
    expect(docsScreen).toContain('import "./styles/docs.css";');
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
