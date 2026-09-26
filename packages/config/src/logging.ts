import { ConfigError, loadConfig, type LoadConfigOptions } from "./document/load.js";
import { resolveLorelumPaths } from "./paths/lorelum.js";

export const loggingLevels = ["error", "warn", "info", "debug"] as const;
export type LoggingLevel = (typeof loggingLevels)[number];

export interface LoggingSettings {
  readonly level: LoggingLevel;
}

/** Result of validating the persistent logging section without throwing on value errors. */
export type ResolvedLoggingSettings =
  | { readonly status: "valid"; readonly level: LoggingLevel }
  | {
      readonly status: "invalid";
      /** Canonical string form of the rejected `logging.level` value. */
      readonly received: string;
      readonly allowedValues: readonly LoggingLevel[];
      /** Path of the config file the value was read from, exactly as resolved for reading. */
      readonly source: string;
    };

export const DEFAULT_LOGGING_SETTINGS: LoggingSettings = Object.freeze({ level: "info" });

function invalid(): never {
  throw new ConfigError();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalReceived(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

function configSource(options: LoadConfigOptions): string {
  return options.filePath ?? resolveLorelumPaths(options.homeDirectory).configFile;
}

/** Validates only the logging section's `level` value; document-level failures still throw. */
export async function resolveLoggingSettings(
  options: LoadConfigOptions = {},
): Promise<ResolvedLoggingSettings> {
  const document = await loadConfig(options);
  if (document.logging === undefined)
    return Object.freeze({ status: "valid", level: DEFAULT_LOGGING_SETTINGS.level });
  if (!isRecord(document.logging)) invalid();
  const level = document.logging.level;
  if (level === undefined)
    return Object.freeze({ status: "valid", level: DEFAULT_LOGGING_SETTINGS.level });
  if (typeof level === "string" && loggingLevels.includes(level as LoggingLevel)) {
    return Object.freeze({ status: "valid", level: level as LoggingLevel });
  }
  return Object.freeze({
    status: "invalid",
    received: canonicalReceived(level),
    allowedValues: loggingLevels,
    source: configSource(options),
  });
}

/** Reads only the logging section; other consumer-owned sections remain untouched. */
export async function loadLoggingSettings(
  options: LoadConfigOptions = {},
): Promise<LoggingSettings> {
  const resolved = await resolveLoggingSettings(options);
  if (resolved.status === "invalid") throw new ConfigError();
  return resolved.level === DEFAULT_LOGGING_SETTINGS.level
    ? DEFAULT_LOGGING_SETTINGS
    : Object.freeze({ level: resolved.level });
}
