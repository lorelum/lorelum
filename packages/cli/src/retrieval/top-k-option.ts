import { invalidInvocationError } from "../runtime/errors.js";

export interface TopKOptionBounds {
  readonly defaultTopK: number;
  readonly minTopK: number;
  readonly maxTopK: number;
}

/**
 * Parse the `--top-k <count>` option against the given command bounds.
 * Undefined falls back to the default; malformed or out-of-range values
 * are `usage.invalid`. Used by `query` (ADR 0010) and future retrieval
 * commands that expose the same bounded option.
 */
export function parseTopKOption(value: unknown, bounds: TopKOptionBounds): number {
  if (value === undefined) return bounds.defaultTopK;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw invalidInvocationError();
  }
  const topK = Number.parseInt(value, 10);
  if (topK < bounds.minTopK || topK > bounds.maxTopK) throw invalidInvocationError();
  return topK;
}
