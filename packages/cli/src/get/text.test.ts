import { expect, test } from "bun:test";

import { renderGetDecisionText } from "./text.js";

const practice = {
  id: "sample.resource",
  title: "Read supplementary material when needed",
  stage: "implementation",
  tech_stack: ["typescript"],
  applies_when: "a compatibility review needs the matrix",
  severity: "warn",
  body: "Read [matrix](resource:references/matrix.md) when checking an API.",
  anti_patterns: [
    {
      id: "sample.skip-matrix",
      name: "Skip the matrix",
      description: "Misses a breaking change",
      severity: "critical",
    },
  ],
};

test("get text keeps complete guidance and every Store source root", () => {
  const text = renderGetDecisionText({
    practice,
    contentDigest: "a".repeat(64),
    sources: [
      {
        packName: "first",
        sourcePath: "practices/resource.md",
        packRoot: "/packs/p-first/current",
      },
      {
        packName: "second",
        sourcePath: "practices/resource.md",
        packRoot: "/packs/p-second/current",
      },
    ],
  });
  expect(text).toContain("[matrix](resource:references/matrix.md)");
  expect(text).toContain("packRoot: /packs/p-first/current");
  expect(text).toContain("packRoot: /packs/p-second/current");
  expect(text).toContain("name: Skip the matrix");
  expect(text).toContain("description: Misses a breaking change");
  expect(text).toContain("severity: critical");
  expect(text).not.toContain("contentDigest:");
  expect(text).not.toContain("stage:");
  expect(text).not.toContain("id: sample.skip-matrix");
  expect(text).not.toContain("severity: warn");
});

test("ProjectContext source is labeled as provenance, not a usable resource path", () => {
  const text = renderGetDecisionText({
    practice: { ...practice, anti_patterns: [] },
    contentDigest: "a".repeat(64),
    sources: [{ packName: "local", sourcePath: "", packRoot: "project-layer-1" }],
  });
  expect(text).toContain("packRoot: project-layer-1");
  expect(text).toContain("logical project provenance; not a filesystem path");
  expect(text).not.toContain("anti_patterns:");
});
