import { describe, expect, test } from "bun:test";

import type { EffectivePractice } from "../local-store/model/types.js";
import { retrievePractice } from "./retrieve.js";

function effectivePractice(
  id: string,
  overrides: Partial<EffectivePractice["practice"]> = {},
): EffectivePractice {
  const practice: EffectivePractice["practice"] = {
    id,
    title: `Practice ${id}`,
    stage: "test",
    tech_stack: ["typescript"],
    applies_when: "testing get retrieval",
    severity: "warn",
    body: `Guidance for ${id}.`,
    anti_patterns: [],
    ...overrides,
  };
  const contentDigest = `${id}-digest`;
  return {
    practiceId: id,
    contentDigest,
    canonicalContent: id,
    practice,
    sources: [
      {
        packName: `pack-${id.replaceAll(".", "-")}`,
        practiceId: id,
        contentDigest,
        sourcePath: `practices/${id}.md`,
        canonicalPractice: { practice, canonicalContent: id, contentDigest },
      },
    ],
  };
}

describe("retrievePractice", () => {
  test("resolves exactly one id and projects the canonical Practice plus sources", () => {
    const result = retrievePractice(
      [
        effectivePractice("react.api", {
          title: "Layer React API access",
          severity: "critical",
          body: "Keep transport behind a feature boundary.",
          anti_patterns: [
            {
              id: "react.direct-http",
              name: "Direct HTTP client in component",
              description: "Calling axios from a component couples UI to transport.",
              severity: "critical",
            },
          ],
        }),
      ],
      "react.api",
    );

    expect(result).toEqual({
      practice: {
        id: "react.api",
        title: "Layer React API access",
        stage: "test",
        tech_stack: ["typescript"],
        applies_when: "testing get retrieval",
        severity: "critical",
        body: "Keep transport behind a feature boundary.",
        anti_patterns: [
          {
            id: "react.direct-http",
            name: "Direct HTTP client in component",
            description: "Calling axios from a component couples UI to transport.",
            severity: "critical",
          },
        ],
      },
      sources: [
        {
          pack: "pack-react-api",
          sourcePath: "practices/react.api.md",
        },
      ],
    });
  });

  test("returns null when no effective Practice matches the id", () => {
    expect(retrievePractice([effectivePractice("react.api")], "react.state")).toBeNull();
  });

  test("preserves canonical defaults and sorts source claims deterministically", () => {
    const effective = effectivePractice("react.api");
    const result = retrievePractice([effective], "react.api");

    expect(result?.practice).toMatchObject({
      severity: "warn",
      body: "Guidance for react.api.",
      anti_patterns: [],
    });
    expect(result?.sources).toEqual([
      { pack: "pack-react-api", sourcePath: "practices/react.api.md" },
    ]);
  });
});
