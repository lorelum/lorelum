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

test("fish quotes backslashes and single quotes without evaluating substitutions", async () => {
  const shell = createShellAssociator(async () => ({ shellSessionInjection: "all-shell" }));
  const command = "lore get sample.practice";
  expect(
    await shell.associateShell({
      session: { hostKey: "omp", sessionId: "parent\\'$(injected)" },
      command,
      syntax: "fish",
    }),
  ).toBe(
    "set -gx LORELUM_HOST_KEY 'omp'\n" +
      "set -gx LORELUM_HOST_SESSION_ID 'parent\\\\\\'$(injected)'\n" +
      command,
  );
});

test("cmd safely associates a typical omp UUID and preserves the command", async () => {
  const shell = createShellAssociator(async () => ({ shellSessionInjection: "all-shell" }));
  const command = "lore get sample.practice & exit /b 23";
  expect(
    await shell.associateShell({
      session: { hostKey: "omp", sessionId: "01931ea4-8a9f-7b3c-9a1b-123456789abc" },
      command,
      syntax: "cmd",
    }),
  ).toBe(
    "set LORELUM_HOST_KEY=omp&" +
      "set LORELUM_HOST_SESSION_ID=01931ea4-8a9f-7b3c-9a1b-123456789abc&" +
      command,
  );
});

test.each([
  "a&echo injected",
  "a|echo injected",
  "a%PATH%",
  "a!PATH!",
  'a" & echo x',
  "a^&x",
  "a\nx",
])("cmd declines unsafe session value %s", async (sessionId) => {
  const shell = createShellAssociator(async () => ({ shellSessionInjection: "all-shell" }));
  expect(
    await shell.associateShell({
      session: { hostKey: "omp", sessionId },
      command: "lore get sample.practice",
      syntax: "cmd",
    }),
  ).toBeUndefined();
});

test.each(["echo %LORELUM_HOST_KEY%", "echo first\necho second"])(
  "cmd preserves commands that cannot safely share an assignment line",
  async (command) => {
    const shell = createShellAssociator(async () => ({ shellSessionInjection: "all-shell" }));
    expect(
      await shell.associateShell({
        session: { hostKey: "omp", sessionId: "actual-session" },
        command,
        syntax: "cmd",
      }),
    ).toBeUndefined();
  },
);

test("unknown syntax never adds an association", async () => {
  const shell = createShellAssociator(async () => ({ shellSessionInjection: "all-shell" }));
  expect(
    await shell.associateShell({ session, command: "lore get x", syntax: "unknown" }),
  ).toBeUndefined();
});
