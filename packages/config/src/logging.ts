import {
  ConfigError,
  loadConfig,
  type ConfigReader,
  type LoadConfigOptions,
} from "./document/load.js";

export const loggingLevels = ["error", "warn", "info", "debug"] as const;
export type LoggingLevel = (typeof loggingLevels)[number];

export interface LoggingSettings {
  readonly level: LoggingLevel;
}

export const DEFAULT_LOGGING_SETTINGS: LoggingSettings = Object.freeze({ level: "info" });

function invalid(): never {
  throw new ConfigError();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads only the logging section; other consumer-owned sections remain untouched. */
export async function loadLoggingSettings(
  options: LoadConfigOptions = {},
  readConfig?: ConfigReader,
): Promise<LoggingSettings> {
  const document = await (readConfig === undefined ? loadConfig(options) : readConfig());
  if (document.logging === undefined) return DEFAULT_LOGGING_SETTINGS;
  if (!isRecord(document.logging)) invalid();
  const level = document.logging.level;
  if (level === undefined) return DEFAULT_LOGGING_SETTINGS;
  if (typeof level !== "string" || !loggingLevels.includes(level as LoggingLevel)) invalid();
  return Object.freeze({ level: level as LoggingLevel });
}
