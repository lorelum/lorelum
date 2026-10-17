import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListPackDetailsResult } from "@lorelum/engine";
import type { ReadHint } from "@lorelum/backend/client";
import { ConfigError } from "@lorelum/config";

import { DEFAULT_AGENT_HOOK_SETTINGS, loadAgentHookSettings } from "../agent-settings.js";
import type { HookServiceOverrides } from "../command.js";
import { invokeHook } from "../endpoint.test-helper.js";
import type { TextInput } from "../types.js";

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

function services(overrides: Partial<HookServiceOverrides> = {}): HookServiceOverrides {
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

describe("lore hook workbuddy", () => {
  test("renders the current Catalog through the raw WorkBuddy Hook envelope", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      invokeHook("workbuddy", {
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
      invokeHook("workbuddy", { stdin: input(payload), stdout, stderr, services: services() }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toMatch(/^lore hook workbuddy degraded: /);
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
      invokeHook("workbuddy", {
        stdin: input('{"hook_event_name":"SessionStart"}'),
        stdout,
        stderr,
        services: failing,
      }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toContain("Store is unavailable.");
  });

  test.each(["darwin", "linux", "win32"] as const)(
    "%s passes the session to Bash as POSIX exports on every platform",
    async (platform) => {
      const hintServices = services({
        platform,
        agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
      });
      const original = {
        command: "pwd | cat; exit 23",
        workdir: "/work/tree",
        timeout_ms: 8000,
        extra: { unchanged: true },
      };
      const stdout = new MemoryWriter();
      await invokeHook("workbuddy", {
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
        updatedInput: {
          ...original,
          command:
            "export LORELUM_HOST_KEY='workbuddy'\n" +
            "export LORELUM_HOST_SESSION_ID='parent'\"'\"'one'\n" +
            original.command,
        },
      });
      expect(response.hookSpecificOutput.permissionDecision).toBeUndefined();
      for (const payload of [
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: "parent",
          tool_input: original,
        },
        {
          hook_event_name: "PreToolUse",
          tool_name: "Terminal",
          session_id: "parent",
          tool_input: original,
        },
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: original },
        { hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "parent", tool_input: {} },
      ]) {
        const empty = new MemoryWriter();
        // eslint-disable-next-line no-await-in-loop -- Check each independent no-op payload and its output.
        await invokeHook("workbuddy", {
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
    ["printf '%s' \"$(lore get practice.id)\"", true],
    ["git status", false],
    ["sh scripts/read-practice.sh", false],
  ] as const)("lore-only text detection for %s", async (command, matches) => {
    const stdout = new MemoryWriter();
    await invokeHook("workbuddy", {
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
      services: services({ platform: "win32" }),
    });
    if (matches) {
      expect(JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command).toEndWith(command);
    } else {
      expect(stdout.value).toBe("{}\n");
    }
  });

  test("SubagentStart stays a no-op because WorkBuddy discards Hook stdout there", async () => {
    const hint: ReadHint = {
      id: "sample.read",
      digest: "private-digest",
      title: "Review task boundary",
      appliesWhen: "when delegating",
    };
    const hintServices = services({
      practiceHints: {
        async readRecentHints() {
          return [hint];
        },
      },
    });
    const stdout = new MemoryWriter();
    await invokeHook("workbuddy", {
      stdin: input('{"hook_event_name":"SubagentStart","session_id":"parent"}'),
      stdout,
      stderr: new MemoryWriter(),
      services: hintServices,
    });
    expect(stdout.value).toBe("{}\n");
  });

  test("an invalid Agent setting leaves shell input unchanged and does not block the tool", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    await invokeHook("workbuddy", {
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
    const home = await mkdtemp(join(tmpdir(), "lorelum-workbuddy-hook-mode-"));
    try {
      await mkdir(join(home, ".lorelum"));
      await writeFile(
        join(home, ".lorelum", "config.yaml"),
        "agent:\n  shellSessionInjection: all-shell\n",
      );
      const stdout = new MemoryWriter();
      await invokeHook("workbuddy", {
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

  test.skipIf(Bun.which("sh") === null)(
    "the export rewrite passes session identity to a child process without changing exit status",
    async () => {
      const stdout = new MemoryWriter();
      await invokeHook("workbuddy", {
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
          platform: "win32",
          agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
        }),
      });
      const command = JSON.parse(stdout.value).hookSpecificOutput.updatedInput.command;
      const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
      const [output, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);
      expect(output).toBe("workbuddy/parent'one");
      expect(exitCode).toBe(23);
    },
  );
});
