import { ConfigError, loadConfig, type LoadConfigOptions } from "@lorelum/config";

export type CodexShellSessionInjection = "lore-only" | "all-shell";

export interface CodexHookSettings {
  readonly shellSessionInjection: CodexShellSessionInjection;
}

export const DEFAULT_CODEX_HOOK_SETTINGS: CodexHookSettings = Object.freeze({
  shellSessionInjection: "lore-only",
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads only Codex Hook settings from the shared user configuration. */
export async function loadCodexHookSettings(
  options: LoadConfigOptions = {},
): Promise<CodexHookSettings> {
  const document = await loadConfig(options);
  if (document.codex === undefined) return DEFAULT_CODEX_HOOK_SETTINGS;
  if (!isRecord(document.codex)) throw new ConfigError();
  const value = document.codex.shellSessionInjection;
  if (value === undefined) return DEFAULT_CODEX_HOOK_SETTINGS;
  if (value !== "lore-only" && value !== "all-shell") throw new ConfigError();
  return Object.freeze({ shellSessionInjection: value });
}
