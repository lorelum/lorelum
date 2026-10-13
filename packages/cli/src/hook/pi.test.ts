import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ListPackDetailsResult } from "@lorelum/engine";

import { run } from "../main.js";
import {
  createPiHookResponse,
  parsePiHookInvocation,
  runPiHook,
  type PiHookServices,
  type TextInput,
} from "./pi.js";
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

function services(overrides: Partial<PiHookServices> = {}): PiHookServices {
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

describe("lore hook pi", () => {
  test.each(["session_start", "session_compact"] as const)(
    "renders the current Catalog through the flat Pi %s envelope",
    async (eventName) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      await expect(
        runPiHook({
          stdin: input(JSON.stringify({ hook_event_name: eventName })),
          stdout,
          stderr,
          services: services(),
        }),
      ).resolves.toBe(0);

      expect(stderr.value).toBe("");
      const response = JSON.parse(stdout.value);
      expect(Object.keys(response)).toEqual(["additionalContext"]);
      expect(response.additionalContext).toContain("- agentic-coding");
      expect(response.additionalContext).toContain("Stack scope: typescript");
      expect(response.additionalContext).not.toContain("/private/store");
      expect(response.additionalContext).not.toContain("0.1.0");
      expect(stdout.value).toBe(`${JSON.stringify(response)}\n`);
    },
  );

  test("a successfully read empty Store is not an error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await runPiHook({
      stdin: input('{"hook_event_name":"session_start"}'),
      stdout,
      stderr,
      services: services({
        list: {
          async listPackDetails() {
            return { generation: 1, effectiveRevision: 1, packs: [] };
          },
        },
      }),
    });

    expect(stderr.value).toBe("");
    expect(JSON.parse(stdout.value).additionalContext).toContain("No installed Knowledge Packs");
  });

  test("bounds the delivered Catalog to the shared 4000 character budget", async () => {
    const stdout = new MemoryWriter();
    const packs = Array.from({ length: 200 }, (_value, index) => ({
      name: `pack-${index}`,
      version: "0.1.0",
      packRoot: "/private/store",
      description: "A long description ".repeat(20),
      applies_to: ["typescript", "node"],
    }));
    await runPiHook({
      stdin: input('{"hook_event_name":"session_start"}'),
      stdout,
      stderr: new MemoryWriter(),
      services: services({
        list: {
          async listPackDetails() {
            return { generation: 1, effectiveRevision: 1, packs };
          },
        },
      }),
    });
    const response = JSON.parse(stdout.value);
    expect(response.additionalContext.length).toBeLessThanOrEqual(4_000);
    expect(response.additionalContext).toContain("Catalog entries truncated.");
  });

  test.each([
    ["malformed JSON", "{"],
    ["non-object payload", "[]"],
    ["unknown event", '{"hook_event_name":"session_end"}'],
    ["old host envelope event", '{"hook_event_name":"SessionStart"}'],
  ])("degrades to {} for %s", async (_label, payload) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await expect(
      runPiHook({ stdin: input(payload), stdout, stderr, services: services() }),
    ).resolves.toBe(0);

    expect(stdout.value).toBe("{}\n");
    expect(stderr.value).toMatch(/^lore hook pi degraded: /);
  });

  test("degrades when the selected Store cannot provide Pack details", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    await runPiHook({
      stdin: input('{"hook_event_name":"session_compact"}'),
      stdout,
      stderr,
      services: services({
        list: {
          async listPackDetails() {
            throw new Error("Store is unavailable.");
          },
        },
      }),
    });

    expect(stdout.value).toBe("{}\n");
    expect(stderr.value).toContain("Store is unavailable.");
  });

  test("resolves an isolated --store-root through the shared Store resolver", async () => {
    let receivedRootPath: string | undefined;
    const response = await createPiHookResponse(
      { hook_event_name: "session_start" },
      {
        list: {
          async listPackDetails(options) {
            receivedRootPath = options?.storageRoot?.rootPath;
            return details;
          },
        },
        storageRoot: { rootPath: "/default-store" },
      },
      "isolated-store",
    );

    expect(receivedRootPath).toBe(resolve(process.cwd(), "isolated-store"));
    expect(response.additionalContext).toContain("- agentic-coding");
  });

  test("accepts the global Store override before or after the raw Hook command", () => {
    expect(parsePiHookInvocation(["hook", "pi", "--store-root", "isolated-store"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parsePiHookInvocation(["--store-root=isolated-store", "hook", "pi"])).toEqual({
      storeRoot: "isolated-store",
    });
    expect(parsePiHookInvocation(["hook", "pi", "extra"])).toBeUndefined();
  });

  test("keeps the Pi and ZCode raw Hook invocations disjoint", () => {
    expect(parsePiHookInvocation(["hook", "zcode"])).toBeUndefined();
    expect(parseZcodeHookInvocation(["hook", "pi"])).toBeUndefined();
  });

  test("routes `lore hook pi` before the ordinary CLI registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "lorelum-pi-hook-route-"));
    try {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();
      const exitCode = await run(["hook", "pi"], {
        stdin: input('{"hook_event_name":"session_start"}'),
        stdout,
        stderr,
        piHookServices: services(),
        logDirectory: root,
      });

      expect(exitCode).toBe(0);
      expect(stderr.value).toBe("");
      expect(JSON.parse(stdout.value).additionalContext).toContain("- agentic-coding");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalid CLI arguments stay an ordinary usage error, not an ABI degrade", async () => {
    const root = await mkdtemp(join(tmpdir(), "lorelum-pi-hook-args-"));
    try {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();
      const exitCode = await run(["hook", "pi", "extra"], {
        stdout,
        stderr,
        piHookServices: services(),
        logDirectory: root,
      });

      expect(exitCode).toBe(2);
      expect(stdout.value).toBe("");
      expect(stderr.value).toContain("usage.invalid");
      expect(stderr.value).not.toContain("degraded");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
