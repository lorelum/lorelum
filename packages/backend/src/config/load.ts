import { loadConfig, ConfigError } from "@lorelum/shared/config";
import { homedir } from "node:os";
import { join } from "node:path";
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

export function defaultRuntimeDirectory(homeDirectory = homedir()): string {
  return join(homeDirectory, ".lorelum", "run", "backend");
}

/** Pure resolver for already-read sources; each source must be valid on its own. */
export function resolveBackendSettings(...sources: readonly unknown[]): BackendSettings {
  const values = sources.map((source) => {
    const result = settingsSource.safeParse(source === undefined ? {} : source);
    if (!result.success) throw new BackendError("backend.config-invalid");
    return result.data;
  });
  const resolved = backendSettingsSchema.safeParse(
    Object.assign({}, DEFAULT_BACKEND_SETTINGS, ...values),
  );
  if (!resolved.success) throw new BackendError("backend.config-invalid");
  return Object.freeze(resolved.data);
}

export interface LoadBackendConfigOptions {
  readonly homeDirectory?: string;
  readonly filePath?: string;
  readonly environment?: Environment;
  /** Dependency injection, not an additional public CLI surface. */
  readonly overrides?: Partial<BackendSettings>;
}

/** Defaults < shared YAML file < named environment values < explicit injection. No writes. */
export async function loadBackendConfig(
  options: LoadBackendConfigOptions = {},
): Promise<BackendConfig> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;
  const fromEnvironment: Record<string, number> = {};
  for (const [key, variable] of Object.entries(environmentKeys)) {
    const value = environment[variable];
    if (value === undefined) continue;
    if (!/^[1-9][0-9]*$/.test(value)) throw new BackendError("backend.config-invalid");
    fromEnvironment[key] = Number(value);
  }
  let document: Readonly<Record<string, unknown>>;
  try {
    document = await loadConfig(options);
  } catch (error) {
    if (error instanceof ConfigError) throw new BackendError("backend.config-invalid");
    throw error;
  }
  const fromFile = document.backend;
  const embedding = resolveEmbeddingConfig(document.embedding);
  return Object.freeze({
    runtimeDirectory: defaultRuntimeDirectory(homeDirectory),
    settings: resolveBackendSettings(fromFile, fromEnvironment, options.overrides),
    ...(embedding === undefined ? {} : { embedding }),
  });
}
