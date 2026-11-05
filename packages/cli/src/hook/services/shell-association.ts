import type { SessionRef } from "@lorelum/backend/client";
import type { AgentHookSettings } from "../agent-settings.js";
import type { ShellAssociator, ShellSyntax } from "../types.js";

export function createShellAssociator(
  loadSettings: () => Promise<AgentHookSettings>,
  resolveSyntax?: (settings: AgentHookSettings, syntax: ShellSyntax) => ShellSyntax,
): ShellAssociator {
  return {
    async associateShell({ session, command, syntax }) {
      const settings = await loadSettings();
      return associateShellCommand(
        session,
        command,
        settings,
        resolveSyntax?.(settings, syntax) ?? syntax,
      );
    },
  };
}

/** Associate only this shell invocation; never change the host process environment. */
export function associateShellCommand(
  session: SessionRef,
  command: string,
  settings: AgentHookSettings,
  syntax: ShellSyntax,
): string | undefined {
  if (settings.shellSessionInjection === "lore-only" && !containsLoreToken(command)) {
    return undefined;
  }
  switch (syntax) {
    case "unknown":
      return undefined;
    case "powershell":
      return (
        `$env:LORELUM_HOST_KEY = ${powerShellQuote(session.hostKey)}\n` +
        `$env:LORELUM_HOST_SESSION_ID = ${powerShellQuote(session.sessionId)}\n` +
        command
      );
    case "fish":
      return (
        `set -gx LORELUM_HOST_KEY '${session.hostKey.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'\n` +
        `set -gx LORELUM_HOST_SESSION_ID '${session.sessionId.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'\n` +
        command
      );
    case "cmd":
      // Only allow session IDs without cmd metacharacters. Percent expansion of
      // other variables stays unchanged; these two are assigned on this line.
      if (
        !/^[A-Za-z0-9_.:-]+$/.test(session.hostKey) ||
        !/^[A-Za-z0-9_.:-]+$/.test(session.sessionId) ||
        /[\r\n]|%LORELUM_HOST_(?:KEY|SESSION_ID)%/i.test(command)
      )
        return undefined;
      return (
        `set LORELUM_HOST_KEY=${session.hostKey}&` +
        `set LORELUM_HOST_SESSION_ID=${session.sessionId}&` +
        command
      );
    case "posix":
      return (
        `export LORELUM_HOST_KEY=${shellQuote(session.hostKey)}\n` +
        `export LORELUM_HOST_SESSION_ID=${shellQuote(session.sessionId)}\n` +
        command
      );
  }
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
