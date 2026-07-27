import { validatePack, type PackInput, type ValidationIssue } from "@lorelum/format";

import { canonicalizePractice } from "./canonical-practice";
import { InvalidSourcePathError, PackValidationError } from "./errors";
import type { PackCandidate, PackSnapshot, PracticeSource } from "./types";

function isWindowsReservedPathSegment(segment: string): boolean {
  const baseName = segment.split(".", 1)[0]?.toLowerCase();
  return (
    baseName === "con" ||
    baseName === "prn" ||
    baseName === "aux" ||
    baseName === "nul" ||
    baseName === "clock$" ||
    /^com[1-9]$/.test(baseName ?? "") ||
    /^lpt[1-9]$/.test(baseName ?? "")
  );
}

function isNormalizedPracticePath(path: string): boolean {
  return (
    /^practices\/(?:[^/]+\/)*[^/]+\.md$/.test(path) &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.includes("*") &&
    !path.includes("<") &&
    !path.includes(">") &&
    !path.includes("|") &&
    !path.includes(String.fromCharCode(34)) &&
    !path.includes(String.fromCharCode(63)) &&
    !path.includes(String.fromCharCode(0)) &&
    !path
      .split("/")
      .some(
        (segment) => segment === "." || segment === ".." || isWindowsReservedPathSegment(segment),
      )
  );
}

function snapshotPack(input: PackInput["pack"]): PackSnapshot {
  const snapshot = structuredClone(input);
  if (snapshot.applies_to !== undefined) Object.freeze(snapshot.applies_to);
  if (snapshot.depends_on !== undefined) Object.freeze(snapshot.depends_on);
  if (typeof snapshot.author === "object" && snapshot.author !== null)
    Object.freeze(snapshot.author);
  return Object.freeze(snapshot) as PackSnapshot;
}

/** Construct a storage-ready candidate only after the format authoring gate passes. */
export function createPackCandidate(
  input: PackInput,
  sourcePathsByPracticeId: Readonly<Record<string, string>>,
): { candidate: PackCandidate; diagnostics: readonly ValidationIssue[] } {
  const report = validatePack(input);
  if (!report.valid) throw new PackValidationError(report);
  const practiceIds = new Set(input.practices.map((practice) => practice.id));
  for (const sourcePracticeId of Object.keys(sourcePathsByPracticeId)) {
    if (!practiceIds.has(sourcePracticeId)) {
      throw new InvalidSourcePathError(
        sourcePracticeId,
        sourcePathsByPracticeId[sourcePracticeId] ?? "(missing)",
      );
    }
  }

  const sources: PracticeSource[] = input.practices.map((practice) => {
    const sourcePath = Object.hasOwn(sourcePathsByPracticeId, practice.id)
      ? sourcePathsByPracticeId[practice.id]
      : undefined;
    if (sourcePath === undefined || !isNormalizedPracticePath(sourcePath)) {
      throw new InvalidSourcePathError(practice.id, sourcePath ?? "(missing)");
    }

    const canonicalPractice = canonicalizePractice(practice);
    return Object.freeze({
      packName: input.pack.name,
      practiceId: practice.id,
      contentDigest: canonicalPractice.contentDigest,
      sourcePath,
      canonicalPractice,
    });
  });
  const sourcePaths = new Set<string>();
  for (const source of sources) {
    if (sourcePaths.has(source.sourcePath)) {
      throw new InvalidSourcePathError(source.practiceId, `${source.sourcePath} (duplicate)`);
    }
    sourcePaths.add(source.sourcePath);
  }

  return {
    candidate: Object.freeze({ pack: snapshotPack(input.pack), sources: Object.freeze(sources) }),
    diagnostics: [...report.warnings, ...report.infos],
  };
}
