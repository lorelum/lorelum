import { describe, expect, test } from "bun:test";

import { reactPack } from "@lorelum/format";

import { createPackCandidate } from "./candidate";
import { InvalidSourcePathError, PackValidationError } from "./errors";

function sourcePaths(): Record<string, string> {
  return {
    "react.api.layered-design": "practices/api/layered-design.md",
    "react.state.redux": "practices/state/redux.md",
    "react.auth.guard": "practices/auth/guard.md",
  };
}

describe("createPackCandidate", () => {
  test("creates canonical sources and returns non-blocking validation diagnostics", () => {
    const input = reactPack();
    input.practices[0]!.severity = undefined;
    const { candidate, diagnostics } = createPackCandidate(input, sourcePaths());

    expect(candidate.sources).toHaveLength(3);
    expect(candidate.sources[0]?.packName).toBe("react-fullstack");
    expect(diagnostics.some((diagnostic) => diagnostic.code === "missing-severity")).toBe(true);
  });

  test("rejects format-invalid candidates before they become sources", () => {
    const input = reactPack();
    input.practices[0]!.id = "invalid";
    expect(() => createPackCandidate(input, sourcePaths())).toThrow(PackValidationError);
  });

  test("rejects missing, traversal, non-Practice, and unexpected source paths", () => {
    const input = reactPack();
    expect(() => createPackCandidate(input, {})).toThrow(InvalidSourcePathError);

    const paths = sourcePaths();
    paths["react.api.layered-design"] = "practices/../escape.md";
    expect(() => createPackCandidate(input, paths)).toThrow(InvalidSourcePathError);

    paths["react.api.layered-design"] = "docs/api.md";
    expect(() => createPackCandidate(input, paths)).toThrow(InvalidSourcePathError);

    const platformUnsafe = sourcePaths();
    platformUnsafe["react.api.layered-design"] = "practices/C:unsafe.md";
    expect(() => createPackCandidate(input, platformUnsafe)).toThrow(InvalidSourcePathError);

    const reservedName = sourcePaths();
    reservedName["react.api.layered-design"] = "practices/con.md";
    expect(() => createPackCandidate(input, reservedName)).toThrow(InvalidSourcePathError);

    const illegalCharacter = sourcePaths();
    illegalCharacter["react.api.layered-design"] = `practices/unsafe${String.fromCharCode(63)}.md`;
    expect(() => createPackCandidate(input, illegalCharacter)).toThrow(InvalidSourcePathError);

    const unexpected = sourcePaths();
    unexpected["react.extra.practice"] = "practices/guide..draft.md";
    expect(() => createPackCandidate(input, unexpected)).toThrow(InvalidSourcePathError);

    const acceptedName = sourcePaths();
    acceptedName["react.api.layered-design"] = "practices/guide..draft.md";
    expect(() => createPackCandidate(input, acceptedName)).not.toThrow();

    const duplicate = sourcePaths();
    duplicate["react.state.redux"] = duplicate["react.api.layered-design"]!;
    expect(() => createPackCandidate(input, duplicate)).toThrow(InvalidSourcePathError);
  });

  test("returns frozen Pack and Practice snapshots", () => {
    const input = reactPack();
    const { candidate } = createPackCandidate(input, sourcePaths());
    input.pack.version = "0.2.0";
    input.practices[0]!.body = "mutated after canonicalization";

    expect(candidate.pack.version).toBe("0.1.0");
    expect(candidate.sources[0]?.canonicalPractice.practice.body).not.toBe(
      "mutated after canonicalization",
    );
    expect(Object.isFrozen(candidate.sources)).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.sources[0])).toBe(true);
    expect(Object.isFrozen(candidate.sources[0]?.canonicalPractice.practice)).toBe(true);
  });

  test("does not read a source path from an inherited property", () => {
    const inheritedPaths = Object.create({
      "react.api.layered-design": "practices/api/layered-design.md",
    }) as Record<string, string>;
    expect(() => createPackCandidate(reactPack(), inheritedPaths)).toThrow(InvalidSourcePathError);
  });
});
