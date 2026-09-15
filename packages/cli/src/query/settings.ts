import { ConfigError, loadConfig, type LoadConfigOptions } from "@lorelum/config";

import { CliError } from "../runtime/errors";

export interface QuerySettings {
  readonly maxWaitMs: number;
  readonly minCoveragePercent: number;
}

export const DEFAULT_QUERY_SETTINGS: QuerySettings = Object.freeze({
  maxWaitMs: 3_000,
  minCoveragePercent: 0,
});

function invalid(): never {
  throw new CliError("query.config-invalid", "The query configuration is invalid.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    invalid();
  return value;
}

/** Consumer-owned validation: unrelated query fields remain available to their owners. */
export async function loadQuerySettings(options: LoadConfigOptions = {}): Promise<QuerySettings> {
  let document: Readonly<Record<string, unknown>>;
  try {
    document = await loadConfig(options);
  } catch (error) {
    if (error instanceof ConfigError) invalid();
    throw error;
  }
  if (document.query === undefined) return DEFAULT_QUERY_SETTINGS;
  if (!isPlainObject(document.query)) invalid();
  return Object.freeze({
    maxWaitMs: integer(document.query.maxWaitMs, 0, 120_000) ?? DEFAULT_QUERY_SETTINGS.maxWaitMs,
    minCoveragePercent:
      integer(document.query.minCoveragePercent, 0, 100) ??
      DEFAULT_QUERY_SETTINGS.minCoveragePercent,
  });
}
