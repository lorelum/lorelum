import { ConfigError, loadConfig, type LoadConfigOptions } from "@lorelum/config";

export type ShellSessionInjection = "lore-only" | "all-shell";

export interface AgentHookSettings {
  readonly shellSessionInjection: ShellSessionInjection;
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
): Promise<AgentHookSettings> {
  const document = await loadConfig(options);
  if (document.agent === undefined) return DEFAULT_AGENT_HOOK_SETTINGS;
  if (!isRecord(document.agent)) throw new ConfigError();
  const value = document.agent.shellSessionInjection;
  if (value === undefined) return DEFAULT_AGENT_HOOK_SETTINGS;
  if (value !== "lore-only" && value !== "all-shell") throw new ConfigError();
  return Object.freeze({ shellSessionInjection: value });
}
