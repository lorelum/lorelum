import { describe, expect, test } from "bun:test";

import { compareSourceResults, projectSourceResult } from "./source-projection.js";

const sampleSource = {
  packName: "react-fullstack",
  practiceId: "react.api-client",
  contentDigest: "digest",
  sourcePath: "practices/react/api-client.md",
  canonicalPractice: {
    practice: {
      id: "react.api-client",
      title: "Layer React API access",
      stage: "api-layer",
      tech_stack: ["react"],
      applies_when: "adding remote requests",
      severity: "warn" as const,
      body: "Guidance.",
      anti_patterns: [],
    },
    canonicalContent: "{}",
    contentDigest: "digest",
  },
};

describe("source projection helpers", () => {
  test("projects LocalStore source claims to the shared retrieval shape", () => {
    expect(projectSourceResult(sampleSource)).toEqual({
      pack: "react-fullstack",
      sourcePath: "practices/react/api-client.md",
    });
  });

  test("orders projected sources deterministically by pack then source path", () => {
    const unsorted = [
      { pack: "z-pack", sourcePath: "practices/a.md" },
      { pack: "a-pack", sourcePath: "practices/z.md" },
      { pack: "a-pack", sourcePath: "practices/a.md" },
    ];

    expect([...unsorted].sort(compareSourceResults)).toEqual([
      { pack: "a-pack", sourcePath: "practices/a.md" },
      { pack: "a-pack", sourcePath: "practices/z.md" },
      { pack: "z-pack", sourcePath: "practices/a.md" },
    ]);
  });
});
