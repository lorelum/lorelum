import { describe, expect, test } from "bun:test";
import type { ListPackDetailsResult } from "@lorelum/engine";
import type { ReadHint } from "@lorelum/backend/client";

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
          services: services({ platform }),
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
        services: services({ platform: "win32" }),
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
