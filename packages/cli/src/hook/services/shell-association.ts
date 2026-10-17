import type { SessionRef } from "@lorelum/backend/client";
import type { AgentHookSettings } from "../agent-settings.js";
import type { ShellAssociator } from "../types.js";

export function createShellAssociator(
  loadSettings: () => Promise<AgentHookSettings>,
): ShellAssociator {
  return {
    async associateShell({ session, command, syntax }) {
      return associateShellCommand(session, command, await loadSettings(), syntax);
    },
  };
}

/** Associate only this shell invocation; never change the host process environment. */
export function associateShellCommand(
  session: SessionRef,
  command: string,
  settings: AgentHookSettings,
  syntax: "posix" | "powershell",
): string | undefined {
  if (settings.shellSessionInjection === "lore-only" && !containsLoreToken(command)) {
    return undefined;
  }
  return (
    (syntax === "powershell"
      ? `$env:LORELUM_HOST_KEY = ${powerShellQuote(session.hostKey)}\n` +
        `$env:LORELUM_HOST_SESSION_ID = ${powerShellQuote(session.sessionId)}\n`
      : `export LORELUM_HOST_KEY=${shellQuote(session.hostKey)}\n` +
        `export LORELUM_HOST_SESSION_ID=${shellQuote(session.sessionId)}\n`) + command
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function containsLoreToken(command: string): boolean {
  return /(^|[^A-Za-z0-9_-])lore(?=$|[^A-Za-z0-9_-])/.test(command);
}
