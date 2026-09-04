export const DEFAULT_TOP_K = 5;
export const MIN_TOP_K = 1;
export const MAX_TOP_K = 50;

/** Normalize a retrieval result cap without turning malformed input into an error. */
export function normalizeTopK(value: number | undefined): number {
  const topK = Number.isInteger(value) ? (value as number) : DEFAULT_TOP_K;
  return Math.min(Math.max(topK, MIN_TOP_K), MAX_TOP_K);
}
