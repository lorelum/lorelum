import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListPackDetailsResult } from "@lorelum/engine";
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

describe("lore hook cursor", () => {
  test("renders the current Catalog through the raw Cursor Hook envelope", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      invokeHook("cursor", {
        stdin: input('{"hook_event_name":"sessionStart"}'),
        stdout,
        stderr,
        services: services(),
      }),
    ).resolves.toBe(0);

    expect(stderr.value).toBe("");
    expect(JSON.parse(stdout.value)).toEqual({
      additional_context: expect.stringContaining("Engineering guidance."),
    });
    expect(stdout.value).toContain("- agentic-coding");
    expect(stdout.value).toContain("Stack scope: typescript");
    expect(stdout.value).not.toContain("Pack root:");
    expect(stdout.value).not.toContain("/private/store");
    expect(stdout.value).not.toContain("0.1.0");
    expect(stdout.value).not.toContain("hookSpecificOutput");
  });

  test.each([
    ["malformed JSON", "{"],
    ["non-object payload", "[]"],
    ["unsupported event", '{"hook_event_name":"PostCompact"}'],
    ["wrong-case event", '{"hook_event_name":"SessionStart"}'],
  ])("degrades for %s", async (_label, payload) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      invokeHook("cursor", { stdin: input(payload), stdout, stderr, services: services() }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toMatch(/^lore hook cursor degraded: /);
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
      invokeHook("cursor", {
        stdin: input('{"hook_event_name":"sessionStart"}'),
        stdout,
        stderr,
        services: failing,
      }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toContain("Store is unavailable.");
  });

  test.each(["darwin", "linux", "win32"] as const)(
    "%s rewrites the Shell tool input as a flat updated_input envelope",
    async (platform) => {
      const hintServices = services({
        platform,
        agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
      });
      const original = { command: "pwd | cat; exit 23", explanation: "probe", extra: [1] };
      const stdout = new MemoryWriter();
      await invokeHook("cursor", {
        stdin: input(
          JSON.stringify({
            hook_event_name: "preToolUse",
            tool_name: "Shell",
            conversation_id: "parent'one",
            tool_input: original,
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: hintServices,
      });
      const response = JSON.parse(stdout.value);
      expect(response).toEqual({
        updated_input: {
          ...original,
          command:
            "export LORELUM_HOST_KEY='cursor'\n" +
            "export LORELUM_HOST_SESSION_ID='parent'\"'\"'one'\n" +
            original.command,
        },
      });
      expect(response.permission).toBeUndefined();
      expect(response.hookSpecificOutput).toBeUndefined();
    },
  );

  test("prefers session_id and falls back to conversation_id", async () => {
    for (const payload of [
      {
        hook_event_name: "preToolUse",
        tool_name: "Shell",
        session_id: "from-session",
        conversation_id: "from-conversation",
        tool_input: { command: "lore get practice.id" },
      },
      {
        hook_event_name: "preToolUse",
        tool_name: "Shell",
        conversation_id: "from-conversation",
        tool_input: { command: "lore get practice.id" },
      },
    ]) {
      const stdout = new MemoryWriter();
      // eslint-disable-next-line no-await-in-loop -- Check each independent session-id source.
      await invokeHook("cursor", {
        stdin: input(JSON.stringify(payload)),
        stdout,
        stderr: new MemoryWriter(),
        services: services({ platform: "linux" }),
      });
      expect(JSON.parse(stdout.value).updated_input.command).toContain(
        payload.session_id ?? payload.conversation_id,
      );
    }
  });

  test.each([
    {
      hook_event_name: "postToolUse",
      tool_name: "Shell",
      conversation_id: "parent",
      tool_input: { command: "lore get practice.id" },
    },
    {
      hook_event_name: "preToolUse",
      tool_name: "Write",
      conversation_id: "parent",
      tool_input: { command: "lore get practice.id" },
    },
    {
      hook_event_name: "preToolUse",
      tool_name: "Shell",
      tool_input: { command: "lore get practice.id" },
    },
    {
      hook_event_name: "preToolUse",
      tool_name: "Shell",
      conversation_id: "parent",
      tool_input: { command: 7 },
    },
  ])("no-ops for $hook_event_name/$tool_name without a usable shell command", async (payload) => {
    const stdout = new MemoryWriter();
    await invokeHook("cursor", {
      stdin: input(JSON.stringify(payload)),
      stdout,
      stderr: new MemoryWriter(),
      services: services({ platform: "linux" }),
    });
    expect(stdout.value).toBe("{}\n");
  });

  test.each(["git status", "sh scripts/read-practice.sh"])(
    "lore-only default leaves %s untouched",
    async (command) => {
      const stdout = new MemoryWriter();
      await invokeHook("cursor", {
        stdin: input(
          JSON.stringify({
            hook_event_name: "preToolUse",
            tool_name: "Shell",
            conversation_id: "parent",
            tool_input: { command },
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: services({ platform: "linux" }),
      });
      expect(stdout.value).toBe("{}\n");
    },
  );

  test("subagentStart stays a no-op because Cursor cannot inject context there", async () => {
    const stdout = new MemoryWriter();
    await invokeHook("cursor", {
      stdin: input('{"hook_event_name":"subagentStart","conversation_id":"parent"}'),
      stdout,
      stderr: new MemoryWriter(),
      services: services({
        practiceHints: {
          async readRecentHints() {
            throw new Error("hints are never read for Cursor subagents");
          },
        },
      }),
    });
    expect(stdout.value).toBe("{}\n");
  });

  test("an invalid Agent setting leaves shell input unchanged and does not block the tool", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    await invokeHook("cursor", {
      stdin: input(
        JSON.stringify({
          hook_event_name: "preToolUse",
          tool_name: "Shell",
          conversation_id: "parent",
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
  });

  test("the user-level all-shell setting covers indirect script calls", async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-cursor-hook-mode-"));
    try {
      await mkdir(join(home, ".lorelum"));
      await writeFile(
        join(home, ".lorelum", "config.yaml"),
        "agent:\n  shellSessionInjection: all-shell\n",
      );
      const stdout = new MemoryWriter();
      await invokeHook("cursor", {
        stdin: input(
          JSON.stringify({
            hook_event_name: "preToolUse",
            tool_name: "Shell",
            conversation_id: "parent",
            tool_input: { command: "sh scripts/read-practice.sh" },
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: services({
          agentHookSettings: () => loadAgentHookSettings({ homeDirectory: home }),
        }),
      });
      expect(JSON.parse(stdout.value).updated_input.command).toEndWith(
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
      await invokeHook("cursor", {
        stdin: input(
          JSON.stringify({
            hook_event_name: "preToolUse",
            tool_name: "Shell",
            conversation_id: "parent'one",
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
      const command = JSON.parse(stdout.value).updated_input.command;
      const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
      const [output, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);
      expect(output).toBe("cursor/parent'one");
      expect(exitCode).toBe(23);
    },
  );
});
