import { describe, expect, test } from "bun:test";

import { analyzeLocalizationState } from "./state";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("localization state analysis", () => {
  test("classifies current, stale, missing, and orphaned paths", () => {
    expect(
      analyzeLocalizationState({
        canonicalDigests: {
          "practices/a.md": digest("a"),
          "practices/b.md": digest("b"),
          "practices/c.md": digest("c"),
        },
        entries: [
          { path: "practices/a.md", source_digest: digest("a") },
          { path: "practices/b.md", source_digest: digest("x") },
          { path: "practices/old.md", source_digest: digest("o") },
        ],
        localizedPaths: [
          "practices/a.md",
          "practices/b.md",
          "practices/old.md",
          "practices/untracked.md",
        ],
      }),
    ).toEqual({
      current: ["practices/a.md"],
      stale: ["practices/b.md"],
      missing: ["practices/c.md"],
      orphaned: ["practices/old.md", "practices/untracked.md"],
    });
  });

  test("requires a localized file for current and treats an unrecorded file as stale", () => {
    const source = digest("a");
    expect(
      analyzeLocalizationState({
        canonicalDigests: { "practices/a.md": source, "practices/b.md": source },
        entries: [{ path: "practices/a.md", source_digest: source }],
        localizedPaths: ["practices/b.md"],
      }),
    ).toEqual({
      current: [],
      stale: ["practices/b.md"],
      missing: ["practices/a.md"],
      orphaned: [],
    });
  });
});
