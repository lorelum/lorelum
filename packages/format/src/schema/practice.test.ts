import { describe, expect, test } from "bun:test";

import { AntiPatternSchema, PracticeSchema } from "./practice";

const layeredDesign = {
  id: "react.api.layered-design",
  title: "Layered API Design",
  stage: "api-layer",
  tech_stack: ["react", "typescript"],
  applies_when: "building an API layer in a React SPA",
  body: "Concrete guidance: http client, base API, modules, DTO boundary.",
  anti_patterns: [
    {
      id: "api.direct-axios-in-component",
      name: "Call axios inside components",
      description: "Wrap axios in the API layer; call it via hooks.",
      severity: "warn",
    },
  ],
};

describe("PracticeSchema", () => {
  test("accepts the layered-design seed practice", () => {
    expect(PracticeSchema.safeParse(layeredDesign).success).toBe(true);
  });

  test("accepts without optional severity / body / anti_patterns", () => {
    const r = PracticeSchema.safeParse({
      id: "react.api.layered-design",
      title: "Layered API Design",
      stage: "api-layer",
      tech_stack: ["react"],
      applies_when: "building an API layer",
    });
    expect(r.success).toBe(true);
  });

  test.each(["id", "title", "stage", "tech_stack", "applies_when"])(
    "rejects missing %s",
    (field) => {
      const { [field]: _removed, ...rest } = layeredDesign;
      expect(PracticeSchema.safeParse(rest).success).toBe(false);
    },
  );

  test("rejects non-array tech_stack", () => {
    expect(PracticeSchema.safeParse({ ...layeredDesign, tech_stack: "react" }).success).toBe(false);
  });

  test("does NOT default severity (input stays undefined so validate can warn)", () => {
    const r = PracticeSchema.safeParse({
      id: "react.api.layered-design",
      title: "Layered API Design",
      stage: "api-layer",
      tech_stack: ["react"],
      applies_when: "building an API layer",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.severity).toBeUndefined();
    }
  });
});

describe("AntiPatternSchema", () => {
  test("accepts a structured anti-pattern", () => {
    expect(AntiPatternSchema.safeParse(layeredDesign.anti_patterns?.[0]).success).toBe(true);
  });

  test("accepts an arbitrary reserved `check` value (format undefined in v1)", () => {
    expect(
      AntiPatternSchema.safeParse({
        id: "api.direct-axios-in-component",
        name: "x",
        description: "x",
        check: { any: { shape: true } },
      }).success,
    ).toBe(true);
  });

  test("rejects missing description", () => {
    expect(AntiPatternSchema.safeParse({ id: "api.x", name: "x" }).success).toBe(false);
  });
});
