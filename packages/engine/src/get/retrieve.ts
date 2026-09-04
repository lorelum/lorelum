import type { EffectivePractice } from "../local-store/model/types.js";
import { compareSourceResults, projectSourceResult } from "../retrieval/source-projection.js";
import type { GetPracticeResult } from "./types.js";

/**
 * Resolve exactly one Practice id against LocalStore Effective Practices.
 * Pure and deterministic: source claims are projected to `PracticeSourceResult`
 * and sorted by `(pack, sourcePath)` (ADR 0011). Returns `null` when no
 * Practice matches; the service boundary owns converting that to a typed
 * `UnknownPracticeError`.
 */
export function retrievePractice(
  effectivePractices: readonly EffectivePractice[],
  practiceId: string,
): GetPracticeResult | null {
  const effective = effectivePractices.find((candidate) => candidate.practiceId === practiceId);
  if (effective === undefined) return null;

  return {
    practice: {
      id: effective.practice.id,
      title: effective.practice.title,
      stage: effective.practice.stage,
      tech_stack: [...effective.practice.tech_stack],
      applies_when: effective.practice.applies_when,
      severity: effective.practice.severity,
      body: effective.practice.body,
      anti_patterns: effective.practice.anti_patterns.map((antiPattern) => ({
        ...antiPattern,
      })),
    },
    sources: effective.sources.map(projectSourceResult).sort(compareSourceResults),
  };
}
