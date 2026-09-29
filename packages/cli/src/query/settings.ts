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

function invalid(subject = "query"): never {
  throw new CliError(
    "query.config-invalid",
    `Invalid ${subject} in ~/.lorelum/config.yaml. Fix or remove the setting.`,
  );
}

function invalidSetting(key: string, min: number, max: number): never {
  throw new CliError(
    "query.config-invalid",
    `${key} must be an integer from ${min} through ${max}. Fix or remove it in ~/.lorelum/config.yaml.`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, key: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalidSetting(key, min, max);
  if (value < min || value > max) invalidSetting(key, min, max);
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
  if (!isPlainObject(document.query)) invalid("query section");
  return Object.freeze({
    maxWaitMs:
      integer(document.query.maxWaitMs, "query.maxWaitMs", 0, 120_000) ??
      DEFAULT_QUERY_SETTINGS.maxWaitMs,
    minCoveragePercent:
      integer(document.query.minCoveragePercent, "query.minCoveragePercent", 0, 100) ??
      DEFAULT_QUERY_SETTINGS.minCoveragePercent,
  });
}
