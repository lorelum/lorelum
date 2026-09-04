import type { EffectivePractice } from "../local-store/model/types.js";
import type { PracticeSourceResult } from "./types.js";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Project one LocalStore source claim to the shared retrieval shape. */
export function projectSourceResult(
  source: EffectivePractice["sources"][number],
): PracticeSourceResult {
  return { pack: source.packName, sourcePath: source.sourcePath };
}

/** Deterministic `(pack, sourcePath)` ordering for projected source claims. */
export function compareSourceResults(
  left: PracticeSourceResult,
  right: PracticeSourceResult,
): number {
  return (
    compareCodeUnits(left.pack, right.pack) || compareCodeUnits(left.sourcePath, right.sourcePath)
  );
}
