import { describe, expect, test } from "bun:test";
import type { ListPackDetailsResult } from "@lorelum/engine";

import { parseCodexHookInvocation } from "./codex.js";
import { parseCursorHookInvocation, runCursorHook, type CursorHookServices } from "./cursor.js";
import { parseZcodeHookInvocation } from "./zcode.js";
import type { TextInput } from "./host-hook.js";

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

function services(overrides: Partial<CursorHookServices> = {}): CursorHookServices {
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

describe("lore hook cursor", () => {
  test("renders the current Catalog through the raw Cursor Hook envelope", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      runCursorHook({
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
      runCursorHook({ stdin: input(payload), stdout, stderr, services: services() }),
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
      runCursorHook({
        stdin: input('{"hook_event_name":"sessionStart"}'),
        stdout,
        stderr,
        services: failing,
      }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toContain("Store is unavailable.");
  });

  test("accepts the global Store override before or after the raw Hook command", () => {
    expect(parseCursorHookInvocation(["hook", "cursor", "--store-root", "isolated-store"])).toEqual(
      {
        storeRoot: "isolated-store",
      },
    );
    expect(parseCursorHookInvocation(["--store-root=isolated-store", "hook", "cursor"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseCursorHookInvocation(["hook", "cursor", "extra"])).toBeUndefined();
  });

  test("keeps the Codex, ZCode, and Cursor raw Hook invocations disjoint", () => {
    expect(parseCursorHookInvocation(["hook", "codex"])).toBeUndefined();
    expect(parseCursorHookInvocation(["hook", "zcode"])).toBeUndefined();
    expect(parseCodexHookInvocation(["hook", "cursor"])).toBeUndefined();
    expect(parseZcodeHookInvocation(["hook", "cursor"])).toBeUndefined();
  });
});
