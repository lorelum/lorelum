import { ConfigError, configValueType, type ConfigSource } from "./failure.js";
import { resolveConfigWithFallback, type ConfigResolution } from "./fallback.js";
import { loadConfig, type ConfigReader, type LoadConfigOptions } from "./document/load.js";
import { resolveLorelumPaths } from "./paths/lorelum.js";

export const loggingLevels = ["error", "warn", "info", "debug"] as const;
export type LoggingLevel = (typeof loggingLevels)[number];

export interface LoggingSettings {
  readonly level: LoggingLevel;
}

export const DEFAULT_LOGGING_SETTINGS: LoggingSettings = Object.freeze({ level: "info" });

export type LoggingResolution =
  | {
      readonly kind: "configured";
      readonly persistentLevel: LoggingLevel;
      readonly effectiveLevel: LoggingLevel;
    }
  | {
      readonly kind: "fallback";
      readonly fallbackLevel: "info";
      readonly effectiveLevel: "info" | "debug";
      readonly cause:
        | { readonly kind: "config"; readonly error: ConfigError }
        | { readonly kind: "unavailable" };
    };

export type ResolveLoggingSettingsOptions = LoadConfigOptions & {
  readonly readConfig?: ConfigReader;
  readonly debug?: boolean;
};

function configSource(options: LoadConfigOptions): ConfigSource {
  return {
    kind: "file",
    path: options.filePath ?? resolveLorelumPaths(options.homeDirectory).configFile,
  };
}

function invalid(failure: Extract<ConfigError["failure"], { kind: "setting" }>): never {
  throw new ConfigError(failure);
}

/** Reads and validates only the logging section; other consumer-owned sections remain untouched. */
export async function loadLoggingSettings(
  options: LoadConfigOptions = {},
  readConfig?: ConfigReader,
): Promise<LoggingSettings> {
  const document = await (readConfig === undefined ? loadConfig(options) : readConfig());
  const source = configSource(options);
  const logging = document.logging;
  if (logging === undefined) return DEFAULT_LOGGING_SETTINGS;
  if (!isRecord(logging)) {
    const type = configValueType(logging);
    invalid({
      kind: "setting",
      source,
      subject: "logging",
      reason: "type",
      rule: { kind: "shape", expected: "object" },
      ...(type === undefined ? {} : { receivedType: type }),
    });
  }
  const level = logging.level;
  if (level === undefined) return DEFAULT_LOGGING_SETTINGS;
  if (typeof level !== "string") {
    const type = configValueType(level);
    invalid({
      kind: "setting",
      source,
      subject: "logging.level",
      reason: "type",
      rule: { kind: "enum", values: loggingLevels },
      ...(type === undefined ? {} : { receivedType: type }),
    });
  }
  if (!loggingLevels.includes(level as LoggingLevel)) {
    invalid({
      kind: "setting",
      source,
      subject: "logging.level",
      reason: "enum",
      rule: { kind: "enum", values: loggingLevels },
      receivedType: "string",
    });
  }
  return Object.freeze({ level: level as LoggingLevel });
}

/** Resolves persistent and invocation logging levels without hiding strict loader failures. */
export async function resolveLoggingSettings(
  options: ResolveLoggingSettingsOptions = {},
): Promise<LoggingResolution> {
  const { debug = false, readConfig, ...loadOptions } = options;
  let resolution: ConfigResolution<LoggingSettings>;
  try {
    resolution = await resolveConfigWithFallback(
      () => loadLoggingSettings(loadOptions, readConfig),
      DEFAULT_LOGGING_SETTINGS,
    );
  } catch {
    return {
      kind: "fallback",
      fallbackLevel: "info",
      effectiveLevel: debug ? "debug" : "info",
      cause: { kind: "unavailable" },
    };
  }

  if (resolution.kind === "configured") {
    return {
      kind: "configured",
      persistentLevel: resolution.value.level,
      effectiveLevel: debug ? "debug" : resolution.value.level,
    };
  }
  return {
    kind: "fallback",
    fallbackLevel: "info",
    effectiveLevel: debug ? "debug" : "info",
    cause: { kind: "config", error: resolution.error },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
