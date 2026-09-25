import type { EffectivePractice } from "../../local-store";
import { KeywordIndexUnavailableError } from "../errors";
import { buildKeywordIndex } from "../keyword/keyword-index";
import { projectKeywordPractice } from "../keyword/projection";
import type { SemanticCandidate } from "./index/reader";

/**
 * How far the request's task signal may move one Practice on the same 0..1
 * similarity scale. The adjustment is bounded on purpose: similarity remains
 * the base order, and the task signal decides near ties rather than replacing
 * the semantic reader. The bound is small relative to the margin a clear
 * semantic winner has over the next candidate and still larger than the
 * near-ties that the frozen retrieval baseline failed to order; the evidence
 * is recorded in the advance-task-aware-semantic-retrieval change.
 */
export const SEMANTIC_TASK_SIGNAL_WEIGHT = 0.05;

export interface SemanticTaskMeasurement {
  /** Request text after canonical query parsing. */
  readonly text: string;
  /** Canonical Practices of this attempt and snapshot. */
  readonly practices: readonly EffectivePractice[];
}

/** One request's relative task/stage strength per Practice, normalized to 0..1. */
export interface SemanticTaskSignal {
  measure(request: SemanticTaskMeasurement): ReadonlyMap<string, number>;
}

/**
 * Task signal derived from the canonical Practice fields the keyword
 * projection already owns. The fixed keyword field weights make identity,
 * title and applicability dominate technology names and prose, so a Practice
 * that only shares a domain, tech stack or entity with the request cannot
 * build as strong a signal as one whose stated moment matches it.
 *
 * The index is request-private, offline and deterministic; Practices with no
 * term overlap are absent from the returned map.
 */
export const canonicalPracticeTaskSignal: SemanticTaskSignal = Object.freeze({
  measure(request: SemanticTaskMeasurement) {
    if (request.practices.length === 0) return new Map<string, number>();
    const index = buildKeywordIndex(request.practices.map(projectKeywordPractice));
    try {
      const hits = index.search(request.text, request.practices.length);
      if (hits.length === 0) return new Map<string, number>();
      let strongest = Number.NEGATIVE_INFINITY;
      let weakest = Number.POSITIVE_INFINITY;
      for (const hit of hits) {
        strongest = Math.max(strongest, hit.score);
        weakest = Math.min(weakest, hit.score);
      }
      const spread = strongest - weakest;
      return new Map(
        hits.map((hit) => [hit.practiceId, spread === 0 ? 1 : (hit.score - weakest) / spread]),
      );
    } finally {
      index.close();
    }
  },
});

export interface TaskAwareOrderingInput {
  /** Request text after canonical query parsing. */
  readonly text: string;
  /** Semantic candidates for this attempt, in reader order. */
  readonly candidates: readonly SemanticCandidate[];
  /** Canonical Practices of the same attempt and snapshot. */
  readonly practices: readonly EffectivePractice[];
  /** Test seam; production uses {@link canonicalPracticeTaskSignal}. */
  readonly signal?: SemanticTaskSignal;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Order one request's validated semantic candidates by task and stage
 * relevance. The caller keeps the same snapshot: candidates, canonical
 * Practices and the final `top-k` slice all come from one query attempt.
 */
export function orderSemanticCandidatesByTaskRelevance(
  input: TaskAwareOrderingInput,
): readonly SemanticCandidate[] {
  if (input.candidates.length < 2) return input.candidates;
  const signal = input.signal ?? canonicalPracticeTaskSignal;
  let strength: ReadonlyMap<string, number>;
  try {
    strength = signal.measure({ text: input.text, practices: input.practices });
  } catch (error) {
    // A runtime without SQLite FTS5 keeps the semantic ordering instead of
    // failing the query; the task signal never becomes a new availability gate.
    if (error instanceof KeywordIndexUnavailableError) return input.candidates;
    throw error;
  }
  const ranked = input.candidates.map((candidate) =>
    Object.freeze({
      candidate,
      relevance:
        candidate.similarity +
        SEMANTIC_TASK_SIGNAL_WEIGHT * (strength.get(candidate.practiceId) ?? 0),
    }),
  );
  ranked.sort(
    (left, right) =>
      right.relevance - left.relevance ||
      right.candidate.similarity - left.candidate.similarity ||
      compareCodeUnits(left.candidate.practiceId, right.candidate.practiceId),
  );
  return Object.freeze(ranked.map((entry) => entry.candidate));
}
