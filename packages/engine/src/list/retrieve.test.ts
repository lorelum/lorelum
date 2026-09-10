import { describe, expect, test } from "bun:test";

import type { EffectivePractice, InstalledPackSummary } from "../local-store/index.js";
import { retrievePackPractices, retrievePacks } from "./retrieve.js";

function effectivePractice(
  id: string,
  packNames: readonly string[],
  overrides: Partial<EffectivePractice["practice"]> = {},
): EffectivePractice {
  const practice: EffectivePractice["practice"] = {
    id,
    title: `Practice ${id}`,
    stage: "test",
    tech_stack: ["typescript"],
    applies_when: "testing list retrieval",
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
    sources: packNames.map((packName) => ({
      packName,
      practiceId: id,
      contentDigest,
      sourcePath: `practices/${packName}/${id}.md`,
      canonicalPractice: { practice, canonicalContent: id, contentDigest },
    })),
  };
}

const packs: readonly InstalledPackSummary[] = [
  { name: "zeta", version: "0.2.0" },
  { name: "alpha", version: "0.1.0" },
  { name: "empty-pack", version: "0.3.0" },
];

describe("retrievePacks", () => {
  test("counts Practices by source claim and sorts Packs by name", () => {
    const packsWithExtras = [
      { name: "zeta", version: "0.2.0", storageKey: "p-zeta" },
      { name: "alpha", version: "0.1.0", storageKey: "p-alpha" },
      { name: "empty-pack", version: "0.3.0", storageKey: "p-empty-pack" },
    ] as unknown as readonly InstalledPackSummary[];

    const result = retrievePacks({
      packs: packsWithExtras,
      effectivePractices: [
        effectivePractice("react.state", ["alpha"]),
        effectivePractice("react.api", ["zeta", "alpha", "zeta"]),
        effectivePractice("react.design", ["zeta"]),
      ],
    });

    expect(result.packs).toEqual([
      { name: "alpha", version: "0.1.0", practiceCount: 2 },
      { name: "empty-pack", version: "0.3.0", practiceCount: 0 },
      { name: "zeta", version: "0.2.0", practiceCount: 2 },
    ]);
    expect(Object.isFrozen(result.packs)).toBe(true);
    expect("storageKey" in result.packs[0]!).toBe(false);
  });
});

describe("retrievePackPractices", () => {
  test("returns only Practices claimed by the selected Pack and sorts by id", () => {
    const result = retrievePackPractices({
      packName: "alpha",
      packs,
      effectivePractices: [
        effectivePractice("react.z-state", ["alpha"]),
        effectivePractice("react.a-api", ["alpha", "zeta"]),
        effectivePractice("react.other", ["zeta"]),
      ],
    });

    expect(result).toEqual({
      pack: { name: "alpha", version: "0.1.0" },
      practices: [
        {
          id: "react.a-api",
          title: "Practice react.a-api",
          applies_when: "testing list retrieval",
        },
        {
          id: "react.z-state",
          title: "Practice react.z-state",
          applies_when: "testing list retrieval",
        },
      ],
    });
    if (result === null) throw new Error("expected an installed Pack catalog");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.pack)).toBe(true);
    expect(Object.isFrozen(result.practices)).toBe(true);
    expect(Object.isFrozen(result.practices[0])).toBe(true);

    const sharedInZeta = retrievePackPractices({
      packName: "zeta",
      packs,
      effectivePractices: [
        effectivePractice("react.z-state", ["alpha"]),
        effectivePractice("react.a-api", ["alpha", "zeta"]),
        effectivePractice("react.other", ["zeta"]),
      ],
    });
    expect(sharedInZeta?.practices.map((practice) => practice.id)).toEqual([
      "react.a-api",
      "react.other",
    ]);
  });

  test("returns a zero-Practice Pack as an empty catalog", () => {
    expect(
      retrievePackPractices({
        packName: "empty-pack",
        packs,
        effectivePractices: [effectivePractice("react.api", ["alpha"])],
      }),
    ).toEqual({
      pack: { name: "empty-pack", version: "0.3.0" },
      practices: [],
    });
  });

  test("returns null for an installed-list miss", () => {
    expect(
      retrievePackPractices({
        packName: "missing",
        packs,
        effectivePractices: [],
      }),
    ).toBeNull();
  });
});
