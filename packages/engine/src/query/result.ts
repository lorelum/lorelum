import type { EffectivePractice } from "../local-store";
import type { QueryHit } from "./types";

/** Candidate identity shared by keyword and semantic result assembly. */
export interface QueryCandidateIdentity {
  readonly practiceId: string;
  readonly contentDigest: string;
}

/**
 * Read canonical Practice rows into the public query summary shape.
 *
 * The caller supplies the domain-specific error constructor so keyword and
 * semantic queries preserve their existing typed failure boundaries.
 */
export function assembleQueryHits(
  practices: readonly EffectivePractice[],
  candidates: readonly QueryCandidateIdentity[],
  createError: (message: string) => Error,
): readonly QueryHit[] {
  const byId = new Map(practices.map((practice) => [practice.practiceId, practice]));
  const results = candidates.map((candidate): QueryHit => {
    const effective = byId.get(candidate.practiceId);
    if (effective === undefined || effective.contentDigest !== candidate.contentDigest) {
      throw createError("Query candidate differs from its query snapshot");
    }
    const { practice } = effective;
    if (practice.severity === undefined) {
      throw createError("Query snapshot is not canonical");
    }
    return Object.freeze({
      practiceId: effective.practiceId,
      title: practice.title,
      stage: practice.stage,
      techStack: Object.freeze([...practice.tech_stack]),
      appliesWhen: practice.applies_when,
      severity: practice.severity,
      contentDigest: effective.contentDigest,
    });
  });
  return Object.freeze(results);
}
