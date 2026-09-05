import type { EffectivePractice } from "../local-store/model/types.js";
import { normalizeTokens } from "../retrieval/tokenize.js";
import { normalizeTopK } from "../retrieval/top-k.js";
import type { RetrievedPractice, RetrievePracticesInput, RetrievedPractices } from "./types.js";

interface PracticeMatch {
  readonly effectivePractice: EffectivePractice;
  readonly score: number;
}

/**
 * Minimal deterministic retrieval over LocalStore Effective Practices:
 * metadata and text token matching with no embeddings or external services.
 * Ties break by Practice id ascending.
 */
export function retrievePractices(input: RetrievePracticesInput): RetrievedPractices {
  const topK = normalizeTopK(input.topK);
  const tokens = normalizeTokens(input.query);
  if (tokens.length === 0) {
    // A query with no tokenizable content is still a valid call; unmatched
    // retrieval is an empty success result, not an invocation error.
    return { query: input.query, k: topK, total: 0, results: [] };
  }

  const matches = input.effectivePractices
    .map((effectivePractice) => ({
      effectivePractice,
      score: scorePractice(effectivePractice.practice, tokens),
    }))
    .filter((match) => match.score > 0)
    .sort(compareMatches);

  return {
    query: input.query,
    k: topK,
    // `total` counts every match before the `k` slice; callers must not treat
    // the omitted tail as "not present" (ADR 0010).
    total: matches.length,
    results: matches.slice(0, topK).map(toRetrievedPractice),
  };
}

/** Field weights: title and applies_when are the recall core. */
const scoredFields = [
  { weight: 3, text: (practice: EffectivePractice["practice"]) => practice.title },
  { weight: 2, text: (practice: EffectivePractice["practice"]) => practice.applies_when },
  { weight: 1, text: (practice: EffectivePractice["practice"]) => practice.stage },
  {
    weight: 1,
    text: (practice: EffectivePractice["practice"]) => practice.tech_stack.join(" "),
  },
  {
    weight: 1,
    text: (practice: EffectivePractice["practice"]) => practice.body,
  },
] as const;

function scorePractice(practice: EffectivePractice["practice"], tokens: readonly string[]): number {
  // Score a field once per distinct token; repeated query words must not
  // inflate a Practice's rank.
  const distinct = new Set(tokens);
  let score = 0;
  for (const field of scoredFields) {
    const haystack = new Set(normalizeTokens(field.text(practice)));
    for (const token of distinct) {
      if (haystack.has(token)) score += field.weight;
    }
  }
  return score;
}

function compareMatches(left: PracticeMatch, right: PracticeMatch): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.effectivePractice.practiceId < right.effectivePractice.practiceId) return -1;
  if (left.effectivePractice.practiceId > right.effectivePractice.practiceId) return 1;
  return 0;
}

function toRetrievedPractice(match: PracticeMatch): RetrievedPractice {
  const practice = match.effectivePractice.practice;
  // Body is intentionally excluded here; query remains a cheap summary slice
  // and full evidence is served by `lore get` (ADR 0010/0011).
  return {
    id: match.effectivePractice.practiceId,
    title: practice.title,
    stage: practice.stage,
    tech_stack: [...practice.tech_stack],
    applies_when: practice.applies_when,
  };
}
