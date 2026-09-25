import {
  loadConfig,
  resolveLorelumPaths,
  ConfigError,
  type LoadConfigOptions,
} from "@lorelum/config";
import { join } from "node:path";
import { homedir } from "node:os";
import { BackendError } from "../protocol/errors";
import {
  backendSettingsSchema,
  DEFAULT_BACKEND_SETTINGS,
  type BackendConfig,
  type BackendSettings,
  type Environment,
} from "./model";
import { resolveEmbeddingConfig } from "./embedding";

const settingsSource = backendSettingsSchema.partial();
const environmentKeys = {
  startupTimeoutMs: "LORELUM_BACKEND_STARTUP_TIMEOUT_MS",
  requestTimeoutMs: "LORELUM_BACKEND_REQUEST_TIMEOUT_MS",
  shutdownTimeoutMs: "LORELUM_BACKEND_SHUTDOWN_TIMEOUT_MS",
} as const;

function invalidSetting(source: string, key?: string): BackendError {
  const target = key === undefined ? source : `${source} ${key}`;
  return new BackendError(
    "backend.config-invalid",
    undefined,
    undefined,
    `Invalid ${target}. Correct or remove that setting, then retry.`,
  );
}

function invalidSettings(source: string, issues: readonly { path: PropertyKey[] }[]): BackendError {
  const key = issues[0]?.path[0];
  const known = typeof key === "string" && key in DEFAULT_BACKEND_SETTINGS ? key : undefined;
  return invalidSetting(source, known);
}

export function defaultRuntimeDirectory(homeDirectory = homedir()): string {
  return join(resolveLorelumPaths(homeDirectory).rootDirectory, "run", "backend");
}

function resolveSettings(sources: readonly { value: unknown; label: string }[]): BackendSettings {
  const values = sources.map(({ value, label }) => {
    const result = settingsSource.safeParse(value === undefined ? {} : value);
    if (!result.success) throw invalidSettings(label, result.error.issues);
    return result.data;
  });
  const resolved = backendSettingsSchema.safeParse(
    Object.assign({}, DEFAULT_BACKEND_SETTINGS, ...values),
  );
  if (!resolved.success) throw invalidSettings("backend settings", resolved.error.issues);
  return Object.freeze(resolved.data);
}

/** Pure resolver for already-read sources; each source must be valid on its own. */
export function resolveBackendSettings(...sources: readonly unknown[]): BackendSettings {
  return resolveSettings(
    sources.map((value, index) => ({ value, label: `backend settings source ${index + 1}` })),
  );
}

export interface LoadBackendConfigOptions extends LoadConfigOptions {
  readonly environment?: Environment;
  /** Dependency injection, not an additional public CLI surface. */
  readonly overrides?: Partial<BackendSettings>;
}

/** Defaults < YAML < named environment < injection. Read-only; validates only this consumer's sections. */
export async function loadBackendConfig(
  options: LoadBackendConfigOptions = {},
): Promise<BackendConfig> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;
  const fromEnvironment: Record<string, number> = {};
  for (const [key, variable] of Object.entries(environmentKeys)) {
    const value = environment[variable];
    if (value === undefined) continue;
    if (!/^[1-9][0-9]*$/.test(value)) throw invalidSetting("environment variable", variable);
    fromEnvironment[key] = Number(value);
  }
  let document: Readonly<Record<string, unknown>>;
  try {
    document = await loadConfig(options);
  } catch (error) {
    if (error instanceof ConfigError) throw invalidSetting("configuration file");
    throw error;
  }
  const fromFile = document.backend;
  const embedding = resolveEmbeddingConfig(document.embedding, homeDirectory);
  return Object.freeze({
    runtimeDirectory: defaultRuntimeDirectory(homeDirectory),
    settings: resolveSettings([
      { value: fromFile, label: "backend section in configuration file" },
      { value: fromEnvironment, label: "backend environment" },
      { value: options.overrides, label: "backend overrides" },
    ]),
    ...(embedding === undefined ? {} : { embedding }),
  });
}
