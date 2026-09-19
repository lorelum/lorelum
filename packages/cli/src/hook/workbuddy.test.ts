import { describe, expect, test } from "bun:test";
import type { ListPackDetailsResult } from "@lorelum/engine";

import { parseCodexHookInvocation } from "./codex.js";
import {
  parseWorkbuddyHookInvocation,
  runWorkbuddyHook,
  type TextInput,
  type WorkbuddyHookServices,
} from "./workbuddy.js";
import { parseZcodeHookInvocation } from "./zcode.js";

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

function services(overrides: Partial<WorkbuddyHookServices> = {}): WorkbuddyHookServices {
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

describe("lore hook workbuddy", () => {
  test("renders the current Catalog through the raw WorkBuddy Hook envelope", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      runWorkbuddyHook({
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
      runWorkbuddyHook({ stdin: input(payload), stdout, stderr, services: services() }),
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
      runWorkbuddyHook({
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
    expect(parseWorkbuddyHookInvocation(["hook", "workbuddy", "--store-root", "isolated-store"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseWorkbuddyHookInvocation(["--store-root=isolated-store", "hook", "workbuddy"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseWorkbuddyHookInvocation(["hook", "workbuddy", "extra"])).toBeUndefined();
  });

  test("keeps the codex, workbuddy, and zcode raw Hook invocations disjoint", () => {
    expect(parseWorkbuddyHookInvocation(["hook", "codex"])).toBeUndefined();
    expect(parseWorkbuddyHookInvocation(["hook", "zcode"])).toBeUndefined();
    expect(parseCodexHookInvocation(["hook", "workbuddy"])).toBeUndefined();
    expect(parseZcodeHookInvocation(["hook", "workbuddy"])).toBeUndefined();
  });
});
