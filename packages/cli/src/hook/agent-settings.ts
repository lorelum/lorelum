import { ConfigError, loadConfig, type LoadConfigOptions } from "@lorelum/config";

export type ShellSessionInjection = "lore-only" | "all-shell";

export interface AgentHookSettings {
  readonly shellSessionInjection: ShellSessionInjection;
  readonly ompShell?: "bash" | "powershell";
}

export const DEFAULT_AGENT_HOOK_SETTINGS: AgentHookSettings = Object.freeze({
  shellSessionInjection: "lore-only",
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads shared Agent Hook settings without changing user configuration. */
export async function loadAgentHookSettings(
  options: LoadConfigOptions = {},
  includeOmpShell = false,
): Promise<AgentHookSettings> {
  const document = await loadConfig(options);
  if (document.agent === undefined) return DEFAULT_AGENT_HOOK_SETTINGS;
  if (!isRecord(document.agent)) throw new ConfigError();
  const value = document.agent.shellSessionInjection;
  if (value !== undefined && value !== "lore-only" && value !== "all-shell")
    throw new ConfigError();
  const ompShell = includeOmpShell ? document.agent.ompShell : undefined;
  if (ompShell !== undefined && ompShell !== "bash" && ompShell !== "powershell")
    throw new ConfigError();
  return Object.freeze({
    shellSessionInjection: value ?? "lore-only",
    ...(ompShell === undefined ? {} : { ompShell }),
  });
}

/** Reads only the opt-in subagent Pack metadata setting, independently of shell policy. */
export async function loadSubagentPackCatalogSetting(
  options: LoadConfigOptions = {},
): Promise<boolean> {
  const document = await loadConfig(options);
  if (document.agent === undefined) return false;
  if (!isRecord(document.agent)) throw new ConfigError();
  const value = document.agent.subagentPackCatalog;
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ConfigError();
  return value;
}
