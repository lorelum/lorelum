import { describe, expect, test } from "bun:test";

import { layeredDesignPractice } from "@lorelum/format";

import { canonicalizePractice } from "./canonical-practice";

describe("canonicalizePractice", () => {
  test("uses fixed keys, defaults, LF line endings, and excludes check", () => {
    const result = canonicalizePractice({
      ...layeredDesignPractice,
      severity: undefined,
      body: "line one\r\nline two\rline three",
      anti_patterns: [
        {
          id: "api.direct-axios-in-component",
          name: "Direct axios",
          description: "Avoid it\r\nUse a hook.",
          check: { experimental: true },
        },
      ],
    });

    expect(result.canonicalContent).toBe(
      '{"id":"react.api.layered-design","title":"Layered API Design","stage":"api-layer","tech_stack":["react","typescript"],"applies_when":"building an API layer in a React SPA","severity":"warn","body":"line one\\nline two\\nline three","anti_patterns":[{"id":"api.direct-axios-in-component","name":"Direct axios","description":"Avoid it\\nUse a hook.","severity":"warn"}]}',
    );
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not let an undefined v1 check field alter a digest", () => {
    const withoutCheck = canonicalizePractice(layeredDesignPractice);
    const withCheck = canonicalizePractice({
      ...layeredDesignPractice,
      anti_patterns: layeredDesignPractice.anti_patterns?.map((antiPattern) => ({
        ...antiPattern,
        check: "future-rule",
      })),
    });
    expect(withCheck.contentDigest).toBe(withoutCheck.contentDigest);
  });

  test("returns the normalized canonical snapshot used by storage and retrieval", () => {
    const result = canonicalizePractice({
      ...layeredDesignPractice,
      severity: undefined,
      body: "line one\r\nline two",
      anti_patterns: layeredDesignPractice.anti_patterns?.map((antiPattern) => ({
        ...antiPattern,
        severity: undefined,
        check: "reserved",
      })),
    });

    expect(result.practice.body).toBe("line one\nline two");
    expect(result.practice.severity).toBe("warn");
    expect(result.practice.anti_patterns?.[0]?.severity).toBe("warn");
    expect(result.practice.anti_patterns?.[0]).not.toHaveProperty("check");
    expect(Object.isFrozen(result)).toBe(true);
  });
});
