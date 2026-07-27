import { describe, expect, test } from "bun:test";

import { reactPack } from "@lorelum/format";

import { createPackCandidate } from "./candidate";
import { InvalidPracticeSourceError, PracticeConflictError } from "./errors";
import { reconcileEffectivePractices, removePackSources } from "./effective-practices";

function candidate(name = "react-fullstack", version = "0.1.0", body?: string) {
  const input = reactPack();
  input.pack.name = name;
  input.pack.version = version;
  if (body !== undefined) input.practices[0]!.body = body;
  return createPackCandidate(input, {
    "react.api.layered-design": "practices/api/layered-design.md",
    "react.state.redux": "practices/state/redux.md",
    "react.auth.guard": "practices/auth/guard.md",
  }).candidate;
}

describe("Effective Practice reconciliation", () => {
  test("coexists for different ids and merges identical multi-Pack sources without a revision", () => {
    const first = candidate("react-core");
    const initially = reconcileEffectivePractices([], first);
    const duplicate = candidate("react-fullstack");
    const reconciled = reconcileEffectivePractices(initially.sources, duplicate);

    expect(initially.delta.added).toHaveLength(3);
    expect(reconciled.effectivePractices).toHaveLength(3);
    expect(reconciled.effectivePractices[0]?.sources).toHaveLength(2);
    expect(reconciled.advancesEffectiveRevision).toBe(false);
  });

  test("rejects a same-id source whose canonical content differs", () => {
    const initial = reconcileEffectivePractices([], candidate("react-core"));
    expect(() =>
      reconcileEffectivePractices(initial.sources, candidate("react-alt", "0.1.0", "Different")),
    ).toThrow(PracticeConflictError);
  });

  test("reports candidate and retained Pack names regardless of source sort order", () => {
    const initial = reconcileEffectivePractices([], candidate("react-z"));
    try {
      reconcileEffectivePractices(initial.sources, candidate("react-a", "0.1.0", "Different"));
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(PracticeConflictError);
      const conflict = error as PracticeConflictError;
      expect(conflict.candidatePackName).toBe("react-a");
      expect(conflict.conflictingPackName).toBe("react-z");
    }
  });

  test("upgrade removes the old Pack sources before testing its replacement", () => {
    const initial = reconcileEffectivePractices([], candidate("react-core"));
    const upgraded = reconcileEffectivePractices(
      initial.sources,
      candidate("react-core", "0.2.0", "Changed guidance"),
      "react-core",
    );

    expect(upgraded.delta.changed).toEqual(["react.api.layered-design"]);
    expect(upgraded.advancesEffectiveRevision).toBe(true);
  });

  test("rejects an upgrade whose replacement name differs from the candidate", () => {
    const initial = reconcileEffectivePractices([], candidate("react-core"));
    expect(() =>
      reconcileEffectivePractices(initial.sources, candidate("react-alt"), "react-core"),
    ).toThrow(InvalidPracticeSourceError);
  });

  test("an upgrade conflicts when a second Pack still provides the old content", () => {
    const initial = reconcileEffectivePractices([], candidate("react-core"));
    const shared = reconcileEffectivePractices(initial.sources, candidate("react-fullstack"));

    expect(() =>
      reconcileEffectivePractices(
        shared.sources,
        candidate("react-core", "0.2.0", "Changed guidance"),
        "react-core",
      ),
    ).toThrow(PracticeConflictError);
  });

  test("only invalidates a Practice after its final source is removed", () => {
    const first = reconcileEffectivePractices([], candidate("react-core"));
    const shared = reconcileEffectivePractices(first.sources, candidate("react-fullstack"));
    const afterFirstRemoval = removePackSources(shared.sources, "react-core");
    const afterLastRemoval = removePackSources(afterFirstRemoval.sources, "react-fullstack");

    expect(afterFirstRemoval.advancesEffectiveRevision).toBe(false);
    expect(afterLastRemoval.delta.invalidated).toEqual([
      "react.api.layered-design",
      "react.auth.guard",
      "react.state.redux",
    ]);
  });

  test("rejects sources whose canonical metadata was corrupted", () => {
    const corrupted = candidate("react-core");
    const source = corrupted.sources[0]!;
    const invalidCandidate = {
      ...corrupted,
      sources: [{ ...source, contentDigest: "0".repeat(64) }],
    };
    expect(() => reconcileEffectivePractices([], invalidCandidate)).toThrow(
      InvalidPracticeSourceError,
    );
  });

  test("rejects a source whose nested canonical digest was corrupted", () => {
    const valid = candidate("react-core");
    const source = valid.sources[0]!;
    const invalidCandidate = {
      ...valid,
      sources: [
        {
          ...source,
          canonicalPractice: { ...source.canonicalPractice, contentDigest: "f".repeat(64) },
        },
      ],
    };
    expect(() => reconcileEffectivePractices([], invalidCandidate)).toThrow(
      InvalidPracticeSourceError,
    );
  });

  test("rejects existing sources with an unsafe path before reconciliation", () => {
    const valid = candidate("react-core");
    const source = valid.sources[0]!;
    expect(() =>
      reconcileEffectivePractices([{ ...source, sourcePath: "practices/../escape.md" }], valid),
    ).toThrow(InvalidPracticeSourceError);
  });
});
