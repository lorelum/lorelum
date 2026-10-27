import {
  ConfigError,
  loadConfig,
  resolveLorelumPaths,
  type ConfigFailure,
  type ConfigRule,
  type ConfigSource,
  type LoadConfigOptions,
} from "@lorelum/config";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import {
  backendSettingsSchema,
  BACKEND_TIMEOUT_LIMITS,
  DEFAULT_BACKEND_SETTINGS,
  type BackendConfig,
  type BackendSettings,
  type Environment,
} from "./model";
import { backendConfigError, backendDocumentError } from "./failure";
import { resolveEmbeddingConfig } from "./embedding";

const settingsSource = backendSettingsSchema.partial();
const environmentKeys = {
  startupTimeoutMs: "LORELUM_BACKEND_STARTUP_TIMEOUT_MS",
  requestTimeoutMs: "LORELUM_BACKEND_REQUEST_TIMEOUT_MS",
  shutdownTimeoutMs: "LORELUM_BACKEND_SHUTDOWN_TIMEOUT_MS",
} as const;

type SettingFailureReason = Extract<ConfigFailure, { kind: "setting" }>["reason"];

interface BackendSettingsSource {
  readonly value: unknown;
  readonly source: ConfigSource;
  readonly sourceForIssue?: (issue: z.ZodIssue) => ConfigSource;
}

function sourceForEnvironmentIssue(issue: z.ZodIssue): ConfigSource {
  const key = issue.path[0];
  if (typeof key === "string" && Object.hasOwn(environmentKeys, key)) {
    return { kind: "environment", variable: environmentKeys[key as keyof typeof environmentKeys] };
  }
  return { kind: "resolved", label: "Backend environment settings" };
}

function issueSubject(issue: z.ZodIssue, section: string): string {
  const path = issue.path.map((part) => String(part));
  if (issue.code === "unrecognized_keys") {
    const [unknownKey] = issue.keys;
    if (unknownKey !== undefined) path.push(unknownKey);
  }
  return path.length === 0 ? section : `${section}.${path.join(".")}`;
}

function issueReason(issue: z.ZodIssue): SettingFailureReason {
  switch (issue.code) {
    case "unrecognized_keys":
      return "unknown-key";
    case "invalid_type":
      return "type";
    case "too_big":
    case "too_small":
      return "range";
    default:
      return "format";
  }
}

function issueRule(issue: z.ZodIssue): ConfigRule | undefined {
  if (issue.code === "invalid_type" && issue.path.length === 0) {
    return { kind: "shape", expected: "object" };
  }
  const [field] = issue.path;
  if (
    issue.path.length === 1 &&
    typeof field === "string" &&
    Object.hasOwn(backendSettingsSchema.shape, field)
  ) {
    return {
      kind: "integer",
      minimum: BACKEND_TIMEOUT_LIMITS.minimum,
      maximum: BACKEND_TIMEOUT_LIMITS.maximum,
    };
  }
  return undefined;
}

function invalidSettings(source: BackendSettingsSource, issues: readonly z.ZodIssue[]): never {
  const issue = issues[0];
  const rule = issue === undefined ? undefined : issueRule(issue);
  const failure: ConfigFailure = {
    kind: "setting",
    source: issue === undefined ? source.source : (source.sourceForIssue?.(issue) ?? source.source),
    subject: issue === undefined ? "backend settings" : issueSubject(issue, "backend"),
    reason: issue === undefined ? "format" : issueReason(issue),
    ...(rule === undefined ? {} : { rule }),
  };
  throw backendConfigError(failure);
}

export function defaultRuntimeDirectory(homeDirectory = homedir()): string {
  return join(resolveLorelumPaths(homeDirectory).rootDirectory, "run", "backend");
}

function resolveSettings(sources: readonly BackendSettingsSource[]): BackendSettings {
  const values = sources.map((source) => {
    const { value } = source;
    const result = settingsSource.safeParse(value === undefined ? {} : value);
    if (!result.success) invalidSettings(source, result.error.issues);
    return result.data;
  });
  const resolved = backendSettingsSchema.safeParse(
    Object.assign({}, DEFAULT_BACKEND_SETTINGS, ...values),
  );
  if (!resolved.success) {
    invalidSettings(
      {
        value: undefined,
        source: { kind: "resolved", label: "Backend settings after source merge" },
      },
      resolved.error.issues,
    );
  }
  return Object.freeze(resolved.data);
}

/** Pure resolver for already-read sources; each source must be valid on its own. */
export function resolveBackendSettings(...sources: readonly unknown[]): BackendSettings {
  return resolveSettings(
    sources.map((value, index) => ({
      value,
      source: { kind: "resolved", label: `Backend settings source ${index + 1}` },
    })),
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
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw backendConfigError({
        kind: "setting",
        source: { kind: "environment", variable },
        subject: `backend.${key}`,
        reason: "format",
        rule: { kind: "positive-decimal-integer-without-leading-zeros" },
      });
    }
    fromEnvironment[key] = Number(value);
  }
  const configFile = options.filePath ?? resolveLorelumPaths(homeDirectory).configFile;
  let document: Readonly<Record<string, unknown>>;
  try {
    document = await loadConfig({ ...options, homeDirectory, filePath: configFile });
  } catch (error) {
    if (error instanceof ConfigError) throw backendDocumentError(error);
    throw error;
  }
  const fromFile = document.backend;
  const embedding = resolveEmbeddingConfig(document.embedding, homeDirectory, {
    kind: "file",
    path: configFile,
  });
  return Object.freeze({
    runtimeDirectory: defaultRuntimeDirectory(homeDirectory),
    settings: resolveSettings([
      { value: fromFile, source: { kind: "file", path: configFile } },
      {
        value: fromEnvironment,
        source: { kind: "resolved", label: "Backend environment settings" },
        sourceForIssue: sourceForEnvironmentIssue,
      },
      { value: options.overrides, source: { kind: "override", label: "Backend overrides" } },
    ]),
    ...(embedding === undefined ? {} : { embedding }),
  });
}
