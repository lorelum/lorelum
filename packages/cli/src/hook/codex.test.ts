import { describe, expect, test } from "bun:test";
import type { ListPackDetailsResult } from "@lorelum/engine";
import type { ReadHint, ShellToolEvent } from "../practice-hints/ledger.js";

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
    ...overrides,
  };
}

describe("lore hook codex", () => {
  test("routes Bash Pre/Post but ignores all non-shell tools", async () => {
    const events: ShellToolEvent[] = [];
    const hintServices = services({
      practiceHints: {
        async routeToolEvent(event) {
          events.push(event);
        },
        async readRecentHints() {
          return [];
        },
      },
    });
    for (const [hook_event_name, tool_name] of [
      ["PreToolUse", "apply_patch"],
      ["PostToolUse", "mcp__example__tool"],
      ["PreToolUse", "Bash"],
      ["PostToolUse", "Bash"],
    ]) {
      const stdout = new MemoryWriter();
      await runCodexHook({
        stdin: input(
          JSON.stringify({
            hook_event_name,
            tool_name,
            session_id: "parent",
            tool_use_id: "tool",
            cwd: "/work",
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: hintServices,
      });
      expect(stdout.value).toBe("{}\n");
    }
    expect(events).toEqual([
      {
        hostKey: "codex",
        event: "pre",
        toolKind: "shell",
        sessionId: "parent",
        toolUseId: "tool",
        cwd: "/work",
      },
      {
        hostKey: "codex",
        event: "post",
        toolKind: "shell",
        sessionId: "parent",
        toolUseId: "tool",
        cwd: "/work",
      },
    ]);
  });

  test("injects bounded, optional metadata only for a matching SubagentStart session", async () => {
    const hint: ReadHint = {
      id: "sample.read",
      digest: "private-digest",
      title: "Review task boundary",
      appliesWhen: "when delegating",
      packs: ["sample"],
    };
    const hintServices = services({
      practiceHints: {
        async routeToolEvent() {},
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

  test("a failed candidate ledger does not block a Bash call or subagent", async () => {
    const failing = services({
      practiceHints: {
        async routeToolEvent() {
          throw new Error("optional hints unavailable");
        },
        async readRecentHints() {
          throw new Error("optional hints unavailable");
        },
      },
    });
    for (const hook_event_name of ["PreToolUse", "SubagentStart"]) {
      const stdout = new MemoryWriter();
      await runCodexHook({
        stdin: input(
          JSON.stringify({
            hook_event_name,
            tool_name: "Bash",
            session_id: "parent",
            tool_use_id: "tool",
            cwd: "/work",
          }),
        ),
        stdout,
        stderr: new MemoryWriter(),
        services: failing,
      });
      expect(stdout.value).toBe("{}\n");
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
    expect(stdout.value).toContain("Pack root: /private/store/packs/p-agentic-coding/current");
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
