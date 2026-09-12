import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHookResponse,
  createHookResponse,
  createCliPackSummarySource,
  parsePackSummaryEnvelope,
} from "./inject-pack-index";
import type { PackSummarySource } from "./types";

describe("inject-pack-index", () => {
  test("parses the metadata envelope", () => {
    expect(
      parsePackSummaryEnvelope({
        ok: true,
        data: {
          packs: [{ name: "react-fullstack", version: "0.1.0", appliesTo: ["react"] }],
        },
      }),
    ).toEqual([{ name: "react-fullstack", version: "0.1.0", appliesTo: ["react"] }]);
  });

  test("rejects an invalid envelope", () => {
    expect(() => parsePackSummaryEnvelope({ ok: false })).toThrow();
    expect(() =>
      parsePackSummaryEnvelope({
        ok: true,
        data: { packs: [{ name: "react", version: "1.0.0" }] },
      }),
    ).toThrow();
    expect(() =>
      parsePackSummaryEnvelope({
        ok: true,
        data: { packs: [{ name: "react", version: "1.0.0", appliesTo: ["react", 42] }] },
      }),
    ).toThrow();
  });

  test("emits additional context for SessionStart and PostCompact", async () => {
    const source: PackSummarySource = {
      async readInstalledPackSummaries() {
        return [{ name: "agentic-coding", version: "0.1.0", appliesTo: [] }];
      },
    };

    for (const eventName of ["SessionStart", "PostCompact"] as const) {
      // eslint-disable-next-line no-await-in-loop -- verify each lifecycle event independently
      const response = await createHookResponse({ hook_event_name: eventName }, source);
      expect(response.hookSpecificOutput?.hookEventName).toBe(eventName);
      expect(response.hookSpecificOutput?.additionalContext).toContain("agentic-coding");
      expect(response).toEqual(buildHookResponse(eventName, expect.any(String)));
    }
  });

  test("times out a CLI process before the hook deadline", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "lorelum-codex-timeout-"));
    const sleeperPath = join(rootPath, "sleep.ts");
    await writeFile(sleeperPath, "await Bun.sleep(10_000);", "utf8");

    try {
      const source = createCliPackSummarySource({
        command: process.execPath,
        args: [sleeperPath],
        timeoutMs: 50,
      });
      await expect(source.readInstalledPackSummaries()).rejects.toThrow(
        "Lorelum metadata command failed with exit code",
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("runs the hook entrypoint for both Codex lifecycle events", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "lorelum-codex-hook-"));
    const fakeSourcePath = join(rootPath, "fake-lore.ts");
    const hookPath = join(import.meta.dir, "inject-pack-index.ts");
    await writeFile(
      fakeSourcePath,
      'process.stdout.write(JSON.stringify({ ok: true, data: { packs: [{ name: "react", version: "1.0.0", appliesTo: ["frontend"] }] } }));',
      "utf8",
    );

    try {
      for (const eventName of ["SessionStart", "PostCompact"] as const) {
        const child = Bun.spawn([process.execPath, hookPath], {
          env: {
            ...process.env,
            LORELUM_CLI_COMMAND: process.execPath,
            LORELUM_CLI_ARGS: JSON.stringify([fakeSourcePath]),
          },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
        child.stdin.write(JSON.stringify({ hook_event_name: eventName }));
        child.stdin.end();
        // eslint-disable-next-line no-await-in-loop -- verify each lifecycle process independently
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          hookSpecificOutput: {
            hookEventName: eventName,
            additionalContext: expect.stringContaining("react"),
          },
        });
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
