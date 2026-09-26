import type { EffectivePractice } from "../../local-store";
import { KeywordIndexError } from "../errors";
import { SemanticIndexQueryError } from "./errors";
import { buildKeywordIndex } from "../keyword/keyword-index";
import { projectKeywordPractice, type KeywordDocument } from "../keyword/projection";
import { encodeTaskSignalToken, taskSignalTokens } from "./task-tokens";
import type { SemanticCandidate } from "./index/reader";

/** Maximum lexical evidence adjustment; semantic similarity remains the base score. */
export const SEMANTIC_TASK_SIGNAL_WEIGHT = 0.05;

export interface SemanticTaskMeasurement {
  /** Request text after canonical query parsing. */
  readonly text: string;
  /** Canonical Practices of this attempt and snapshot. */
  readonly practices: readonly EffectivePractice[];
}

/** Request-local lexical evidence per Practice, bounded to 0..1. */
export interface SemanticTaskSignal {
  measure(request: SemanticTaskMeasurement): ReadonlyMap<string, number>;
}

function taskDocument(practice: EffectivePractice): {
  readonly document: KeywordDocument;
  readonly terms: ReadonlySet<string>;
} {
  const projected = projectKeywordPractice(practice);
  const terms = new Set<string>();
  const encode = (text: string): string =>
    taskSignalTokens(text)
      .map((token) => {
        terms.add(token);
        return encodeTaskSignalToken(token);
      })
      .join(" ");
  return {
    document: {
      ...projected,
      id: encode(projected.id),
      title: encode(projected.title),
      appliesWhen: encode(projected.appliesWhen),
      techStack: encode(projected.techStack),
      stage: encode(projected.stage),
      antiPatterns: encode(projected.antiPatterns),
      body: encode(projected.body),
    },
    terms,
  };
}

/**
 * Canonical lexical evidence, not a task or stage classifier. Saturating the
 * count of distinct matches limits isolated overlaps; relative BM25 retains the field weights
 * without stretching near-equal scores to the full adjustment range.
 */
export const canonicalPracticeTaskSignal: SemanticTaskSignal = Object.freeze({
  measure(request: SemanticTaskMeasurement) {
    const queryTerms = [...new Set(taskSignalTokens(request.text))];
    if (request.practices.length === 0 || queryTerms.length === 0) return new Map<string, number>();
    const documents = request.practices.map(taskDocument);
    const byId = new Map(documents.map(({ document, terms }) => [document.practiceId, terms]));
    const index = buildKeywordIndex(documents.map(({ document }) => document));
    try {
      const hits = index.search(
        queryTerms.map(encodeTaskSignalToken).join(" "),
        request.practices.length,
      );
      const strongest = Math.max(0, ...hits.map((hit) => hit.score));
      if (strongest <= 0) return new Map<string, number>();
      return new Map(
        hits.map((hit) => {
          const terms = byId.get(hit.practiceId)!;
          const matches = queryTerms.filter((term) => terms.has(term)).length;
          return [hit.practiceId, (matches / (matches + 1)) * (hit.score / strongest)];
        }),
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
    if (error instanceof KeywordIndexError) {
      throw new SemanticIndexQueryError("Cannot measure semantic lexical evidence", {
        cause: error,
      });
    }
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
