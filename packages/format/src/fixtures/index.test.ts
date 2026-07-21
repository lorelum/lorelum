import { describe, expect, test } from "bun:test";

import { parseFrontmatter } from "../frontmatter";
import { PracticeSchema } from "../schema";
import { validatePack, validatePractice } from "../validate";
import { layeredDesignMarkdown, layeredDesignPractice, reactPack } from "./index";

describe("fixtures are self-validating", () => {
  test("reactPack passes validatePack with no issues", () => {
    const r = validatePack(reactPack());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.infos).toEqual([]);
  });

  test("layeredDesignPractice passes validatePractice", () => {
    expect(validatePractice(layeredDesignPractice)).toEqual([]);
  });
});

describe("end-to-end: markdown → frontmatter → schema", () => {
  test("parsed markdown data satisfies PracticeSchema", () => {
    const { data } = parseFrontmatter(layeredDesignMarkdown);
    const r = PracticeSchema.safeParse(data);
    expect(r.success).toBe(true);
  });

  test("parsed markdown data matches the practice object on shared fields", () => {
    const { data } = parseFrontmatter(layeredDesignMarkdown);
    // Anti-patterns ship in a separate structured file in real packs, so the
    // markdown carries only the frontmatter fields — compare those.
    expect(data.id).toBe(layeredDesignPractice.id);
    expect(data.title).toBe(layeredDesignPractice.title);
    expect(data.stage).toBe(layeredDesignPractice.stage);
    expect(data.tech_stack).toEqual(layeredDesignPractice.tech_stack);
    expect(data.applies_when).toBe(layeredDesignPractice.applies_when);
    expect(data.severity).toBe(layeredDesignPractice.severity);
  });
});
