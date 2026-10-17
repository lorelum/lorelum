import { expect, test } from "bun:test";
import { DEFAULT_AGENT_HOOK_SETTINGS } from "../agent-settings.js";
import { createShellAssociator } from "./shell-association.js";

const session = { hostKey: "codex" as const, sessionId: "parent'one" };

test.each([
  ["posix", "export LORELUM_HOST_KEY='codex'\nexport LORELUM_HOST_SESSION_ID='parent'\"'\"'one'\n"],
  ["powershell", "$env:LORELUM_HOST_KEY = 'codex'\n$env:LORELUM_HOST_SESSION_ID = 'parent''one'\n"],
] as const)(
  "shell association preserves %s quoting and the original command",
  async (syntax, prefix) => {
    const shell = createShellAssociator(async () => DEFAULT_AGENT_HOOK_SETTINGS);
    const command = "lore get sample.practice; exit 23";
    expect(await shell.associateShell({ session, command, syntax })).toBe(prefix + command);
  },
);

test.each(["pwd", "explorer", "lore-dev get sample.practice", "other_lore", "lore2"])(
  "lore-only leaves %s unchanged",
  async (command) => {
    const shell = createShellAssociator(async () => DEFAULT_AGENT_HOOK_SETTINGS);
    expect(await shell.associateShell({ session, command, syntax: "posix" })).toBeUndefined();
  },
);

test("all-shell associates ordinary commands without changing their contents", async () => {
  const shell = createShellAssociator(async () => ({ shellSessionInjection: "all-shell" }));
  expect(await shell.associateShell({ session, command: "pwd", syntax: "posix" })).toBe(
    "export LORELUM_HOST_KEY='codex'\nexport LORELUM_HOST_SESSION_ID='parent'\"'\"'one'\npwd",
  );
});
