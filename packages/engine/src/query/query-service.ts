import type { EffectivePractice } from "../local-store";
import { KeywordIndexError } from "./errors";
import { buildKeywordIndex, type KeywordCandidate } from "./keyword/keyword-index";
import { projectKeywordPractice } from "./keyword/projection";
import { parseQueryRequest } from "./request";
import type { QueryDependencies, QueryHit, QueryResult, QueryService } from "./types";

/** Dependencies are shared; roots, snapshots and index connections belong to each call. */
export function createQueryService({ store }: QueryDependencies): QueryService {
  return Object.freeze({
    async query(root, request) {
      const input = parseQueryRequest(request);
      const practices = await store.readEffectivePractices(root);
      const index = buildKeywordIndex(practices.map(projectKeywordPractice));
      try {
        return assembleQueryResult(practices, index.search(input.text, input.limit));
      } finally {
        index.close();
      }
    },
  } satisfies QueryService);
}

function assembleQueryResult(
  practices: readonly EffectivePractice[],
  candidates: readonly KeywordCandidate[],
): QueryResult {
  const byId = new Map(practices.map((practice) => [practice.practiceId, practice]));
  const results = candidates.map((candidate): QueryHit => {
    const effective = byId.get(candidate.practiceId);
    if (effective === undefined || effective.contentDigest !== candidate.contentDigest) {
      throw new KeywordIndexError("Keyword candidate differs from its query snapshot");
    }
    const { practice } = effective;
    // LocalStore's canonicalizer expands severity; no new default is defined here.
    if (practice.severity === undefined) {
      throw new KeywordIndexError("Query snapshot is not canonical");
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
  return Object.freeze({ mode: "keyword", results: Object.freeze(results) });
}
