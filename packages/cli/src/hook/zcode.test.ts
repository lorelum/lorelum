import { describe, expect, test } from "bun:test";
import type { ListPackDetailsResult } from "@lorelum/engine";

import { parseCodexHookInvocation } from "./codex.js";
import {
  parseZcodeHookInvocation,
  runZcodeHook,
  type TextInput,
  type ZcodeHookServices,
} from "./zcode.js";

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

function services(overrides: Partial<ZcodeHookServices> = {}): ZcodeHookServices {
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

describe("lore hook zcode", () => {
  test("renders the current Catalog through the raw ZCode Hook envelope", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      runZcodeHook({
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
      runZcodeHook({ stdin: input(payload), stdout, stderr, services: services() }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toMatch(/^lore hook zcode degraded: /);
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
      runZcodeHook({
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
    expect(parseZcodeHookInvocation(["hook", "zcode", "--store-root", "isolated-store"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseZcodeHookInvocation(["--store-root=isolated-store", "hook", "zcode"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parseZcodeHookInvocation(["hook", "zcode", "extra"])).toBeUndefined();
  });

  test("keeps the Codex and ZCode raw Hook invocations disjoint", () => {
    expect(parseZcodeHookInvocation(["hook", "codex"])).toBeUndefined();
    expect(parseCodexHookInvocation(["hook", "zcode"])).toBeUndefined();
  });
});
