import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTraceId } from "@lorelum/log";

import { createProcessLogRuntime } from "./runtime.js";

/**
 * Writes an isolated config home. Tests pass it through the `configOptions`
 * seam because mutating HOME/USERPROFILE in-process does not reliably change
 * the resolved home on every platform Bun runs on.
 */
async function withConfigHome(
  config: string | undefined,
  run: (home: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "lorelum-runtime-home-"));
  if (config !== undefined) {
    await mkdir(join(home, ".lorelum"), { recursive: true });
    await writeFile(join(home, ".lorelum", "config.yaml"), config);
  }
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function stderrCollector(): { lines: string[]; write(message: string): void } {
  const lines: string[] = [];
  return { lines, write: (message) => lines.push(message) };
}

function daySegment(): string {
  return new Date().toISOString().slice(0, 10);
}

test("an invalid logging level surfaces one notice, one stderr line, and one warn record", async () => {
  await withConfigHome("logging:\n  level: noisy\n", async (home) => {
    const logs = await mkdtemp(join(tmpdir(), "lorelum-runtime-logs-"));
    try {
      const stderr = stderrCollector();
      const traceId = createTraceId();
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: false,
        rootDirectory: logs,
        configOptions: { homeDirectory: home },
      });

      expect(runtime.notices.length).toBe(1);
      expect(runtime.notices[0]).toEqual({
        kind: "configuration",
        subject: "logging.level",
        reason: "invalid-value",
        received: "noisy",
        expected: { kind: "enum", values: ["error", "warn", "info", "debug"] },
        effective: "info",
        source: join(home, ".lorelum", "config.yaml"),
      });
      expect(stderr.lines.length).toBe(1);
      expect(stderr.lines[0]).toBe(
        'warning: logging.level "noisy" is invalid (allowed: error, warn, info, debug); using "info" for this invocation.\n',
      );

      await runtime.flush();
      const records = (await readFile(join(logs, "cli", daySegment(), `${traceId}.jsonl`), "utf8"))
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const fallback = records.find((record) => record.message === "logging.level-fallback");
      expect(fallback).toBeDefined();
      expect(fallback?.level).toBe("warn");
      expect(fallback?.traceId).toBe(traceId);
      expect(fallback?.context).toEqual({
        setting: "logging.level",
        received: "noisy",
        effective: "info",
        source: join(home, ".lorelum", "config.yaml"),
      });
    } finally {
      await rm(logs, { recursive: true, force: true });
    }
  });
});

test("a --debug override keeps effective debug while still reporting the rejected level", async () => {
  await withConfigHome("logging:\n  level: noisy\n", async (home) => {
    const logs = await mkdtemp(join(tmpdir(), "lorelum-runtime-logs-"));
    try {
      const stderr = stderrCollector();
      const traceId = createTraceId();
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: true,
        rootDirectory: logs,
        configOptions: { homeDirectory: home },
      });

      expect(runtime.notices.length).toBe(1);
      expect(runtime.notices[0]?.effective).toBe("debug");
      expect(stderr.lines[0]).toBe(
        'warning: logging.level "noisy" is invalid (allowed: error, warn, info, debug); using "debug" for this invocation (--debug overrides persistent config).\n',
      );

      await runtime.flush();
      const records = (await readFile(join(logs, "cli", daySegment(), `${traceId}.jsonl`), "utf8"))
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const fallback = records.find((record) => record.message === "logging.level-fallback");
      expect(fallback?.context).toMatchObject({ received: "noisy", effective: "debug" });
    } finally {
      await rm(logs, { recursive: true, force: true });
    }
  });
});

test("a valid logging level stays silent", async () => {
  await withConfigHome("logging:\n  level: debug\n", async (home) => {
    const logs = await mkdtemp(join(tmpdir(), "lorelum-runtime-logs-"));
    try {
      const stderr = stderrCollector();
      const runtime = await createProcessLogRuntime(stderr, createTraceId(), {
        debug: false,
        rootDirectory: logs,
        configOptions: { homeDirectory: home },
      });
      expect(runtime.notices.length).toBe(0);
      expect(stderr.lines.length).toBe(0);
      await runtime.flush();
    } finally {
      await rm(logs, { recursive: true, force: true });
    }
  });
});

test("a document-level failure keeps the silent fail-open behavior", async () => {
  await withConfigHome("logging: [unclosed\n", async (home) => {
    const logs = await mkdtemp(join(tmpdir(), "lorelum-runtime-logs-"));
    try {
      const stderr = stderrCollector();
      const runtime = await createProcessLogRuntime(stderr, createTraceId(), {
        debug: false,
        rootDirectory: logs,
        configOptions: { homeDirectory: home },
      });
      expect(runtime.notices.length).toBe(0);
      expect(stderr.lines.length).toBe(0);
      await runtime.flush();
    } finally {
      await rm(logs, { recursive: true, force: true });
    }
  });
});

test("persistence disabled still surfaces the notice and stderr line", async () => {
  await withConfigHome("logging:\n  level: noisy\n", async (home) => {
    const stderr = stderrCollector();
    const runtime = await createProcessLogRuntime(stderr, createTraceId(), {
      debug: false,
      persist: false,
      configOptions: { homeDirectory: home },
    });
    expect(runtime.notices.length).toBe(1);
    expect(stderr.lines.length).toBe(1);
    await runtime.flush();
  });
});

test("an unavailable log directory still surfaces the notice without failing", async () => {
  await withConfigHome("logging:\n  level: noisy\n", async (home) => {
    const blockerRoot = await mkdtemp(join(tmpdir(), "lorelum-runtime-blocked-"));
    try {
      // A file where a directory is required makes every sink path unavailable
      // (ENOTDIR) without platform-specific permission semantics.
      const blocker = join(blockerRoot, "occupied");
      await writeFile(blocker, "not a directory");
      const stderr = stderrCollector();
      const runtime = await createProcessLogRuntime(stderr, createTraceId(), {
        debug: false,
        rootDirectory: join(blocker, "logs"),
        configOptions: { homeDirectory: home },
      });
      expect(runtime.notices.length).toBe(1);
      expect(stderr.lines.length).toBe(1);
      await runtime.flush();
    } finally {
      await rm(blockerRoot, { recursive: true, force: true });
    }
  });
});
