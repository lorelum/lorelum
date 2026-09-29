import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListPackDetailsResult } from "@lorelum/engine";
import type { ReadHint } from "@lorelum/backend/client";
import { ConfigError } from "@lorelum/config";

import { DEFAULT_AGENT_HOOK_SETTINGS, loadAgentHookSettings } from "./agent-settings.js";

import {
  parseCodexHookInvocation,
  runCodexHook,
  type CodexHookServices,
  type TextInput,
} from "./codex.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const details: ListPackDetailsResult = {
  generation: 1,
  effectiveRevision: 2,
  packs: [
    {
      name: "agentic-coding",
      version: "0.1.0",
      packRoot: "/private/store/packs/p-agentic-coding/current",
      description: "Engineering guidance.",
      applies_to: ["typescript"],
    },
  ],
};

function input(value: string): TextInput {
  return {
    async text() {
      return value;
    },
  };
}

function services(overrides: Partial<CodexHookServices> = {}): CodexHookServices {
  return {
    list: {
      async listPackDetails() {
        return details;
      },
    },
    storageRoot: { rootPath: "/default-store" },
    agentHookSettings: async () => DEFAULT_AGENT_HOOK_SETTINGS,
    ...overrides,
  };
}

describe("lore hook codex", () => {
  test.each([
    [
      "darwin",
      "export LORELUM_HOST_KEY='codex'\nexport LORELUM_HOST_SESSION_ID='parent'\"'\"'one'\n",
    ],
    [
      "linux",
      "export LORELUM_HOST_KEY='codex'\nexport LORELUM_HOST_SESSION_ID='parent'\"'\"'one'\n",
    ],
    ["win32", "$env:LORELUM_HOST_KEY = 'codex'\n$env:LORELUM_HOST_SESSION_ID = 'parent''one'\n"],
  ] as const)(
    "%s passes the session to Bash without changing other tool input fields",
    async (platform, prefix) => {
      const hintServices = services({
        platform,
        agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
        practiceHints: {
          async readRecentHints() {
            return [];
          },
        },
      });
      const original = {
        command: "pwd | cat; exit 23",
        workdir: "/work/tree",
        timeout_ms: 8000,
        yield_time_ms: 1000,
        extra: { unchanged: true },
      };
      const stdout = new MemoryWriter();
      await runCodexHook({
        stdin: input(
          JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            session_id: "parent'one",
            tool_input: original,
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: hintServices,
      });
      const response = JSON.parse(stdout.value);
      expect(response.hookSpecificOutput).toEqual({
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          ...original,
          command: prefix + original.command,
        },
      });
      for (const payload of [
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: "parent",
          tool_input: original,
        },
        {
          hook_event_name: "PreToolUse",
          tool_name: "apply_patch",
          session_id: "parent",
          tool_input: original,
        },
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: original },
        { hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "parent", tool_input: {} },
      ]) {
        const empty = new MemoryWriter();
        // eslint-disable-next-line no-await-in-loop -- Check each independent no-op payload and its output.
        await runCodexHook({
          stdin: input(JSON.stringify(payload)),
          stdout: empty,
          stderr: new MemoryWriter(),
          services: hintServices,
        });
        expect(empty.value).toBe("{}\n");
      }
    },
  );

  test.each([
    ["lore get practice.id", true],
    ["echo before | lore get practice.id", true],
    ["printf '%s' \"$(lore get practice.id)\"", true],
    ["/usr/local/bin/lore get practice.id", true],
    ["echo 'lore get practice.id'", true],
    ["git status", false],
    ["sh scripts/read-practice.sh", false],
    ["echo lorelum", false],
  ] as const)("lore-only text detection for %s", async (command, matches) => {
    const stdout = new MemoryWriter();
    await runCodexHook({
      stdin: input(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "parent",
          tool_input: { command },
        }),
      ),
      stdout,
      stderr: new MemoryWriter(),
      services: services({ platform: "linux" }),
    });
    if (matches) {
      expect(JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command).toEndWith(command);
    } else {
      expect(stdout.value).toBe("{}\n");
    }
  });

  test.each(["darwin", "linux", "win32"] as const)(
    "%s defaults to rewriting only a shell command that mentions lore",
    async (platform) => {
      for (const command of ["git status", "lore get practice.id"]) {
        const stdout = new MemoryWriter();
        // eslint-disable-next-line no-await-in-loop -- Check both commands for each host platform.
        await runCodexHook({
          stdin: input(
            JSON.stringify({
              hook_event_name: "PreToolUse",
              tool_name: "Bash",
              session_id: "parent",
              tool_input: { command },
            }),
          ),
          stdout,
          stderr: new MemoryWriter(),
          services: services({ platform }),
        });
        if (command === "git status") {
          expect(stdout.value).toBe("{}\n");
        } else {
          expect(JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command).toEndWith(
            command,
          );
        }
      }
    },
  );

  test("an invalid Agent setting leaves shell input unchanged and does not block the tool", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    await runCodexHook({
      stdin: input(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "parent",
          tool_input: { command: "lore get practice.id" },
        }),
      ),
      stdout,
      stderr,
      services: services({
        agentHookSettings: async () => {
          throw new ConfigError();
        },
      }),
    });
    expect(stdout.value).toBe("{}\n");
    expect(stderr.value).toContain("configuration file is invalid or unreadable");
    expect(stderr.value).not.toContain("practice.id");
  });

  test("the user-level all-shell setting covers indirect script calls", async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-codex-hook-mode-"));
    try {
      await mkdir(join(home, ".lorelum"));
      await writeFile(
        join(home, ".lorelum", "config.yaml"),
        "agent:\n  shellSessionInjection: all-shell\n",
      );
      const stdout = new MemoryWriter();
      await runCodexHook({
        stdin: input(
          JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            session_id: "parent",
            tool_input: { command: "sh scripts/read-practice.sh" },
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: services({
          platform: "linux",
          agentHookSettings: () => loadAgentHookSettings({ homeDirectory: home }),
        }),
      });
      expect(JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command).toEndWith(
        "sh scripts/read-practice.sh",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "Unix rewrites pass session identity to a child process without changing exit status",
    async () => {
      for (const platform of ["darwin", "linux"] as const) {
        const stdout = new MemoryWriter();
        // eslint-disable-next-line no-await-in-loop -- Exercise both Unix adapter branches in a real shell.
        await runCodexHook({
          stdin: input(
            JSON.stringify({
              hook_event_name: "PreToolUse",
              tool_name: "Bash",
              session_id: "parent'one",
              tool_input: {
                command: `sh -c 'printf "%s/%s" "$LORELUM_HOST_KEY" "$LORELUM_HOST_SESSION_ID"'; exit 23`,
              },
            }),
          ),
          stdout,
          stderr: new MemoryWriter(),
          services: services({
            platform,
            agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
          }),
        });
        const command = JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command;
        const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
        // eslint-disable-next-line no-await-in-loop -- Assert each adapter's process result separately.
        const [output, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          child.exited,
        ]);
        expect(output).toBe("codex/parent'one");
        expect(exitCode).toBe(23);
      }
    },
  );

  test.skipIf(process.platform !== "win32")(
    "Windows PowerShell rewrite passes identity to a child process without changing exit status",
    async () => {
      const stdout = new MemoryWriter();
      await runCodexHook({
        stdin: input(
          JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            session_id: "parent'one",
            tool_input: {
              command: 'cmd.exe /C "echo %LORELUM_HOST_KEY%/%LORELUM_HOST_SESSION_ID%"\nexit 23',
            },
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: services({
          platform: "win32",
          agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
        }),
      });
      const command = JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command;
      const child = Bun.spawn(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [output, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);
      expect(output.trim()).toBe("codex/parent'one");
      expect(exitCode).toBe(23);
    },
  );

  test("injects bounded, optional metadata only for a matching SubagentStart session", async () => {
    const hint: ReadHint = {
      id: "sample.read",
      digest: "private-digest",
      title: "Review task boundary",
      appliesWhen: "when delegating",
    };
    const hintServices = services({
      practiceHints: {
        async readRecentHints(host, sessionId) {
          return host === "codex" && sessionId === "parent" ? [hint] : [];
        },
      },
    });
    const stdout = new MemoryWriter();
    await runCodexHook({
      stdin: input('{"hook_event_name":"SubagentStart","session_id":"parent"}'),
      stdout,
      stderr: new MemoryWriter(),
      services: hintServices,
    });
    const response = JSON.parse(stdout.value);
    expect(response.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(response.hookSpecificOutput.additionalContext).toContain("sample.read");
    expect(response.hookSpecificOutput.additionalContext).toContain("lore get <practice-id>");
    expect(response.hookSpecificOutput.additionalContext).not.toContain("Pack");
    expect(response.hookSpecificOutput.additionalContext).not.toContain("packs");
    expect(stdout.value).not.toContain(hint.digest);
    const empty = new MemoryWriter();
    await runCodexHook({
      stdin: input('{"hook_event_name":"SubagentStart","session_id":"unrelated"}'),
      stdout: empty,
      stderr: new MemoryWriter(),
      services: hintServices,
    });
    expect(empty.value).toBe("{}\n");
  });

  test("an unavailable candidate Backend does not block a Bash call or subagent", async () => {
    const failing = services({
      platform: "linux",
      agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
      practiceHints: {
        async readRecentHints() {
          throw new Error("optional hints unavailable");
        },
      },
    });
    for (const hook_event_name of ["PreToolUse", "SubagentStart"]) {
      const stdout = new MemoryWriter();
      // eslint-disable-next-line no-await-in-loop -- Verify independent Hook events and their output.
      await runCodexHook({
        stdin: input(
          JSON.stringify({
            hook_event_name,
            tool_name: "Bash",
            session_id: "parent",
            tool_use_id: "tool",
            cwd: "/work",
            tool_input: { command: "pwd" },
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: failing,
      });
      if (hook_event_name === "PreToolUse") {
        expect(JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command).toContain("pwd");
      } else {
        expect(stdout.value).toBe("{}\n");
      }
    }
  });
  test("renders the current Catalog through the raw Codex Hook envelope", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      runCodexHook({
        stdin: input('{"hook_event_name":"SessionStart"}'),
        stdout,
        stderr,
        services: services(),
      }),
    ).resolves.toBe(0);

    expect(stderr.value).toBe("");
    expect(JSON.parse(stdout.value)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("Engineering guidance."),
      },
    });
    expect(stdout.value).toContain("- agentic-coding");
    expect(stdout.value).toContain("Stack scope: typescript");
    expect(stdout.value).not.toContain("Pack root:");
    expect(stdout.value).not.toContain("/private/store");
    expect(stdout.value).not.toContain("0.1.0");
  });

  test.each([
    ["malformed JSON", "{"],
    ["non-object payload", "[]"],
    ["unsupported event", '{"hook_event_name":"PostCompact"}'],
  ])("degrades for %s", async (_label, payload) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      runCodexHook({ stdin: input(payload), stdout, stderr, services: services() }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toMatch(/^lore hook codex degraded: /);
  });

  test("degrades when the selected Store cannot provide Pack details", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const failing = services({
      list: {
        async listPackDetails() {
          throw new Error("Store is unavailable.");
        },
      },
    });

    await expect(
      runCodexHook({
        stdin: input('{"hook_event_name":"SessionStart"}'),
        stdout,
        stderr,
        services: failing,
      }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toContain("Store is unavailable.");
  });

  test("accepts the global Store override before or after the raw Hook command", () => {
    expect(parseCodexHookInvocation(["hook", "codex", "--store-root", "isolated-store"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseCodexHookInvocation(["--store-root=isolated-store", "hook", "codex"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseCodexHookInvocation(["hook", "codex", "extra"])).toBeUndefined();
  });
});
