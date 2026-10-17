import type { QueryEmbeddingInput } from "../../representation";

/**
 * Query clauses are split only at semantic boundaries that survive across
 * languages. This is not a keyword extractor: the fragments are encoded with
 * the same embedding model as the complete query, and no fragment receives a
 * hand-authored role label or lexical weight.
 */
const QUERY_VIEW_BOUNDARY = /(?:[.!?;。！？；,，、:：]+|\r?\n)+/u;
const MAX_QUERY_VIEWS = 12;
const MIN_QUERY_VIEW_CODE_POINTS = 4;

function compact(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

function queryFragments(text: string): readonly string[] {
  const raw = text
    .split(QUERY_VIEW_BOUNDARY)
    .map(compact)
    .filter((part) => part.length > 0);
  if (raw.length === 0) return Object.freeze([compact(text)]);

  const merged: string[] = [];
  for (const part of raw) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      (codePoints(previous) < MIN_QUERY_VIEW_CODE_POINTS ||
        codePoints(part) < MIN_QUERY_VIEW_CODE_POINTS)
    ) {
      merged[merged.length - 1] = compact(`${previous} ${part}`);
      continue;
    }
    merged.push(part);
  }

  while (merged.length > MAX_QUERY_VIEWS) {
    const last = merged.pop();
    const previous = merged.pop();
    if (previous === undefined || last === undefined) break;
    merged.push(compact(`${previous} ${last}`));
  }
  return Object.freeze(merged);
}

/**
 * Drop the whole-sentence view whenever the query has usable clauses. Keeping
 * the sentence as an additional high-weight view would let domain context
 * dominate the action clause again.
 */
export function projectMultiViewQuery(text: string): readonly QueryEmbeddingInput[] {
  const fragments = queryFragments(text);
  return Object.freeze(
    fragments.map((fragment, ordinal) =>
      Object.freeze({
        inputKey: `clause:${ordinal.toString().padStart(4, "0")}`,
        text: fragment,
        weight: 1,
      }),
    ),
  );
}
