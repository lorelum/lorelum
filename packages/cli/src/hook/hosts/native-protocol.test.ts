import { expect, test } from "bun:test";
import { ConfigError } from "@lorelum/config";
import { DEFAULT_AGENT_HOOK_SETTINGS } from "../agent-settings.js";
import type { HookServiceOverrides } from "../command.js";
import { invokeHook } from "../endpoint.test-helper.js";
import type { TextInput } from "../types.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

function input(value: string): TextInput {
  return { text: async () => value };
}

function services(overrides: Partial<HookServiceOverrides> = {}): Partial<HookServiceOverrides> {
  return {
    agentHookSettings: async () => DEFAULT_AGENT_HOOK_SETTINGS,
    ...overrides,
  };
}
test.each([
  ["codex", "Bash"],
  ["claude", "Bash"],
  ["cursor", "Shell"],
  ["workbuddy", "Bash"],
] as const)(
  "%s preserves camel-case tool aliases and no-op event diagnostics",
  async (host, tool) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    await invokeHook(host, {
      stdin: input(
        JSON.stringify({
          hook_event_name: "preToolUse",
          tool_name: tool,
          session_id: "parent",
          tool_input: { command: "lore get practice.id", extra: { unchanged: true } },
          extra_payload: true,
        }),
      ),
      stdout,
      stderr,
      services: services({ platform: "linux" }),
    });
    const response = JSON.parse(stdout.value);
    const updated =
      host === "cursor" ? response.updated_input : response.hookSpecificOutput.updatedInput;
    expect(updated.command).toEndWith("lore get practice.id");
    expect(updated.extra).toEqual({ unchanged: true });
    expect(stderr.value).toBe("");

    for (const event of ["PostToolUse", "postToolUse", "SubagentStart", "subagentStart"]) {
      const empty = new MemoryWriter();
      const diagnostics = new MemoryWriter();
      // eslint-disable-next-line no-await-in-loop -- Each alias is an independent protocol invocation.
      await invokeHook(host, {
        stdin: input(JSON.stringify({ hook_event_name: event })),
        stdout: empty,
        stderr: diagnostics,
        services: services(),
      });
      expect(empty.value).toBe("{}\n");
      expect(diagnostics.value).toBe("");
    }
  },
);

test.each(["codex", "claude", "cursor", "workbuddy", "zcode"] as const)(
  "%s keeps its native fallback when shell settings fail",
  async (host) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    await invokeHook(host, {
      stdin: input(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: host === "cursor" ? "Shell" : "Bash",
          session_id: "parent",
          tool_input: { command: "lore get practice.id" },
        }),
      ),
      stdout,
      stderr,
      services: services({
        platform: "linux",
        agentHookSettings: async () => {
          throw new ConfigError();
        },
      }),
    });
    expect(stdout.value).toBe(host === "zcode" ? '{"continue":true}\n' : "{}\n");
    expect(stderr.value).toContain("configuration file is invalid or unreadable");
  },
);
