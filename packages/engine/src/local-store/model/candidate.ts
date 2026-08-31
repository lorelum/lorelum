import {
  parsePackInput,
  validateParsedPack,
  type Pack,
  type UnvalidatedPackInput,
  type ValidationIssue,
} from "@lorelum/format";

import { canonicalizePractice } from "./canonical-practice";
import { InvalidSourcePathError, PackValidationError } from "./errors";
import { deepFreeze } from "./freeze";
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

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/** Verify a Pack-root-relative Practice source path without resolving it on disk. */
export function isPracticeSourcePath(path: string): boolean {
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
    !hasControlCharacter(path) &&
    !path
      .split("/")
      .some(
        (segment) => segment === "." || segment === ".." || isWindowsReservedPathSegment(segment),
      )
  );
}

function snapshotPack(pack: Pack): PackSnapshot {
  const snapshot = structuredClone(pack);
  return deepFreeze(snapshot) as PackSnapshot;
}

/** Construct a storage-ready candidate only after the format authoring gate passes. */
export function createPackCandidate(
  input: UnvalidatedPackInput,
  sourcePathsByPracticeId: Readonly<Record<string, string>>,
): { candidate: PackCandidate; diagnostics: readonly ValidationIssue[] } {
  const parsed = parsePackInput(input);
  if (!parsed.ok) throw new PackValidationError(parsed.report);
  const { pack, practices, decisions } = parsed.value;
  // Full report: format gate already passed, so the semantic stages decide
  // validity (reference integrity, cycles) and provide diagnostics.
  const report = validateParsedPack(parsed.value);
  if (!report.valid) throw new PackValidationError(report);
  const practiceIds = new Set(practices.map((practice) => practice.id));
  for (const sourcePracticeId of Object.keys(sourcePathsByPracticeId)) {
    if (!practiceIds.has(sourcePracticeId)) {
      throw new InvalidSourcePathError(
        sourcePracticeId,
        sourcePathsByPracticeId[sourcePracticeId] ?? "(missing)",
      );
    }
  }

  const sources: PracticeSource[] = practices.map((practice) => {
    const sourcePath = Object.hasOwn(sourcePathsByPracticeId, practice.id)
      ? sourcePathsByPracticeId[practice.id]
      : undefined;
    if (sourcePath === undefined || !isPracticeSourcePath(sourcePath)) {
      throw new InvalidSourcePathError(practice.id, sourcePath ?? "(missing)");
    }

    const canonicalPractice = canonicalizePractice(practice);
    return Object.freeze({
      packName: pack.name,
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
    candidate: Object.freeze({
      pack: snapshotPack(pack),
      sources: Object.freeze(sources),
      decisions: Object.freeze(decisions.map((decision) => deepFreeze(structuredClone(decision)))),
    }),
    diagnostics: [...report.warnings, ...report.infos],
  };
}
