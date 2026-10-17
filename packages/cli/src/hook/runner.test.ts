import { describe, expect, test } from "bun:test";
import { runHook } from "./runner.js";
import type { HookEndpoint, TextInput } from "./types.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

async function invoke(endpoint: HookEndpoint, stdin: TextInput) {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const exitCode = await runHook(endpoint, { host: "codex", stdin, stdout, stderr });
  return { stdout: stdout.value, stderr: stderr.value, exitCode };
}

describe("Hook transport", () => {
  test("serializes multiline context as one JSON line without diagnostics", async () => {
    const result = await invoke(
      {
        label: "Codex",
        handle: async () => ({ additionalContext: "first line\n第二行" }),
        fallback: () => ({ continue: true }),
      },
      { text: async () => "{}" },
    );
    expect(result).toEqual({
      stdout: '{"additionalContext":"first line\\n第二行"}\n',
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    {
      failure: "input read failure",
      read: async () => {
        throw new Error("input unavailable");
      },
    },
    { failure: "malformed JSON", read: async () => "{" },
  ])("returns the fallback without running the endpoint on $failure", async ({ read }) => {
    let handled = false;
    const result = await invoke(
      {
        label: "Codex",
        handle: async () => {
          handled = true;
          return { additionalContext: "must not be emitted" };
        },
        fallback: () => ({ continue: true }),
      },
      { text: read },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"continue":true}\n');
    expect(result.stderr).toContain("lore hook codex degraded:");
    expect(handled).toBe(false);
  });

  test.each([{ error: new Error("context unavailable") }, { error: "context unavailable" }])(
    "reports an endpoint failure and emits only its fallback: %j",
    async ({ error }) => {
      const result = await invoke(
        {
          label: "Codex",
          handle: async () => {
            throw error;
          },
          fallback: () => ({ continue: true }),
        },
        { text: async () => '{"hook_event_name":"SessionStart"}' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('{"continue":true}\n');
      expect(result.stderr).toContain("context unavailable");
    },
  );
});
