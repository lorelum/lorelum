import { describe, expect, test } from "bun:test";

import { PracticeSchema } from "../schema";
import { parseFrontmatter } from "./parse";

describe("parseFrontmatter", () => {
  test("parses frontmatter and body", () => {
    const md = `---
id: react.api.layered-design
title: Layered API Design
tech_stack: [react, typescript]
---

# Layered API Design

Concrete guidance here.`;
    const r = parseFrontmatter(md);
    expect(r.data.id).toBe("react.api.layered-design");
    expect(r.data.tech_stack).toEqual(["react", "typescript"]);
    expect(r.content.trim()).toBe("# Layered API Design\n\nConcrete guidance here.");
  });

  test("markdown without frontmatter → empty data, full content", () => {
    const md = "# Just a title\n\nNo frontmatter here.";
    const r = parseFrontmatter(md);
    expect(r.data).toEqual({});
    expect(r.content).toBe(md);
  });

  test("empty frontmatter block → empty data", () => {
    const md = `---
---

Body after the empty block.`;
    const r = parseFrontmatter(md);
    expect(r.data).toEqual({});
    expect(r.content.trim()).toBe("Body after the empty block.");
  });

  test("malformed YAML propagates as a thrown error (not swallowed)", () => {
    const md = `---
key: : invalid
---
body`;
    expect(() => parseFrontmatter(md)).toThrow();
  });

  test("end-to-end: parsed data feeds PracticeSchema.safeParse", () => {
    const md = `---
id: react.api.layered-design
title: Layered API Design
stage: api-layer
tech_stack: [react, typescript]
applies_when: building an API layer in a React SPA
severity: warn
---

Guidance body.`;
    const { data } = parseFrontmatter(md);
    const r = PracticeSchema.safeParse(data);
    expect(r.success).toBe(true);
  });
});
