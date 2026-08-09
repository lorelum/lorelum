import { describe, expect, test } from "bun:test";

import { PracticeSchema } from "../schema";
import { parseFrontmatter, parseYaml } from "./parse";

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

test("parseYaml parses a standalone YAML document", () => {
  expect(parseYaml("name: platform\nitems:\n  - one\n")).toEqual({
    name: "platform",
    items: ["one"],
  });
});

describe("parseYaml safety", () => {
  test("rejects nested alias bombs (exponential expansion via shared subtrees)", () => {
    // Each level doubles the alias references; js-yaml resolves aliases
    // lazily, so this parses fine and explodes on first traversal. The alias
    // budget check must reject it before any consumer expands it.
    const bomb: string[] = ["n0: &n0 [1]"];
    for (let i = 1; i < 30; i++) {
      bomb.push(`n${i}: &n${i} [*n${i - 1}, *n${i - 1}]`);
    }
    expect(() => parseYaml(bomb.join("\n"))).toThrow();
  });

  test("rejects flat alias bombs (one subtree referenced many times)", () => {
    const flat = `base: &base [1, 2, 3]\nitems: [${Array.from({ length: 100 }, () => "*base").join(", ")}]`;
    expect(() => parseYaml(flat)).toThrow();
  });

  test("accepts legitimate bounded alias use", () => {
    const doc = "base: &base [1]\nrefs: [*base, *base]";
    expect(parseYaml(doc)).toEqual({ base: [1], refs: [[1], [1]] });
  });

  test("alias budget boundary: exactly MAX_ALIAS_VISITS re-references pass, one more fails", () => {
    const refs = (count: number) =>
      `base: &base [1]\nrefs: [${Array.from({ length: count }, () => "*base").join(", ")}]`;
    expect(parseYaml(refs(16))).toBeDefined();
    expect(() => parseYaml(refs(17))).toThrow(RangeError);
  });

  test("rejects custom JS types from DEFAULT_SCHEMA", () => {
    expect(() => parseYaml("fn: !!js/function 'return 1'")).toThrow();
    expect(() => parseYaml("undef: !!js/undefined")).toThrow();
  });

  test("alias bombs in frontmatter are rejected through parseFrontmatter", () => {
    const bomb = [
      "a: &a [1]",
      "b: &b [*a, *a]",
      "c: &c [*b, *b]",
      "d: &d [*c, *c]",
      "e: &e [*d, *d]",
      "f: &f [*e, *e]",
      "g: &g [*f, *f]",
      "h: &h [*g, *g]",
    ].join("\n");
    expect(() => parseFrontmatter(`---\n${bomb}\n---\nbody`)).toThrow(RangeError);
  });

  test("rejects oversized documents", () => {
    const oversized = "key: " + "x".repeat(512 * 1024);
    expect(() => parseYaml(oversized)).toThrow(RangeError);
  });
});
