import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTraceId } from "@lorelum/log";

import { createProcessLogRuntime, sinkFailureNotice } from "./runtime.js";

describe("sinkFailureNotice", () => {
  test("a foreign-owned Lorelum root gets the focused non-recursive ownership fix", () => {
    const notice = sinkFailureNotice(
      { category: "foreign-owner", path: "/home/user/.lorelum" },
      "/home/user/.lorelum",
    );
    expect(notice).toContain("diagnostic logs for this run were not saved");
    expect(notice).toContain("/home/user/.lorelum is owned by another user");
    expect(notice).toContain('sudo chown "$(id -u):$(id -g)" /home/user/.lorelum');
    expect(notice).not.toContain("chown -R");
  });

  test("a foreign-owned managed segment uses the generic category form", () => {
    const notice = sinkFailureNotice(
      { category: "foreign-owner", path: "/home/user/.lorelum/logs" },
      "/home/user/.lorelum",
    );
    expect(notice).toContain("(foreign-owner at /home/user/.lorelum/logs)");
    expect(notice).not.toContain("sudo");
  });

  test("unsafe categories render their reason and path", () => {
    expect(
      sinkFailureNotice(
        { category: "symlink", path: "/home/user/.lorelum/logs" },
        "/home/user/.lorelum",
      ),
    ).toBe(
      "lorelum: diagnostic logs for this run were not saved (symlink at /home/user/.lorelum/logs)",
    );
  });

  test("write failures include the operating-system detail", () => {
    expect(
      sinkFailureNotice(
        {
          category: "write-failed",
          path: "/home/user/.lorelum/logs/cli/t.jsonl",
          detail: "ENOSPC",
        },
        "/home/user/.lorelum",
      ),
    ).toBe(
      "lorelum: diagnostic logs for this run were not saved (write-failed at /home/user/.lorelum/logs/cli/t.jsonl: ENOSPC)",
    );
  });
});

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-log-runtime-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function stderrCollector(): { lines: string[]; write(message: string): void } {
  const lines: string[] = [];
  return {
    lines,
    write(message: string): void {
      lines.push(message);
    },
  };
}

test("flush stays quiet when the managed location is usable", async () =>
  fixture(async (directory) => {
    const stderr = stderrCollector();
    const runtime = await createProcessLogRuntime(stderr, createTraceId(), {
      debug: false,
      rootDirectory: join(directory, "logs"),
    });
    runtime.log.error("probe.failed", {});
    await runtime.flush();

    expect(stderr.lines).toEqual([]);
  }));

test("flush reports an unusable managed location once on stderr", async () =>
  fixture(async (directory) => {
    // A regular file at the managed-root path makes the location unusable on
    // every platform — no symlink privileges required.
    await writeFile(join(directory, "logs"), "not a directory", "utf8");
    const stderr = stderrCollector();
    const runtime = await createProcessLogRuntime(stderr, createTraceId(), {
      debug: false,
      rootDirectory: join(directory, "logs"),
    });
    runtime.log.error("probe.failed", {});
    await runtime.flush();

    expect(stderr.lines).toHaveLength(1);
    const [notice] = stderr.lines;
    expect(notice).toContain("diagnostic logs for this run were not saved");
    expect(notice).toContain(`wrong-type at ${join(directory, "logs")}`);
    expect(notice?.endsWith("\n")).toBe(true);
  }));

test("logging and settings share one invocation snapshot, while debug stays lazy", async () =>
  fixture(async (home) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
          import { mkdir, writeFile } from "node:fs/promises";
          import { join } from "node:path";
          import { createTraceId } from "@lorelum/log";
          import { resolveLorelumPaths } from "@lorelum/config";
          import { createProcessLogRuntime } from ${JSON.stringify(join(import.meta.dir, "runtime.ts"))};
          import { loadQuerySettings, loadSemanticRetrievalSettings } from ${JSON.stringify(join(import.meta.dir, "../query/settings.ts"))};

          const paths = resolveLorelumPaths();
          await mkdir(paths.rootDirectory, { recursive: true });
          const oldConfig = "logging:\\n  level: info\\nquery:\\n  maxWaitMs: 100\\n  retrievalMethod: single-vector\\n";
          const newConfig = "logging:\\n  level: warn\\nquery:\\n  maxWaitMs: 200\\n  retrievalMethod: multi-view-vector\\n";
          await writeFile(paths.configFile, oldConfig);
          const stderr = { write() {} };
          const first = await createProcessLogRuntime(stderr, createTraceId(), { debug: false, persist: false });
          await writeFile(paths.configFile, newConfig);
          const firstSettings = await loadQuerySettings({}, first.readConfig);
          const firstMethod = await loadSemanticRetrievalSettings({}, first.readConfig);
          await first.flush();
          const second = await createProcessLogRuntime(stderr, createTraceId(), { debug: false, persist: false });
          const secondSettings = await loadQuerySettings({}, second.readConfig);
          const secondMethod = await loadSemanticRetrievalSettings({}, second.readConfig);
          await second.flush();
          const debug = await createProcessLogRuntime(stderr, createTraceId(), { debug: true, persist: false });
          await writeFile(paths.configFile, oldConfig);
          const debugSettings = await loadQuerySettings({}, debug.readConfig);
          await debug.flush();
          console.log(JSON.stringify({ firstSettings, firstMethod, secondSettings, secondMethod, debugSettings }));
        `,
      ],
      {
        cwd: import.meta.dir,
        env: { ...process.env, HOME: home, USERPROFILE: home },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      firstSettings: { maxWaitMs: 100, minCoveragePercent: 0 },
      firstMethod: { retrievalMethod: "single-vector" },
      secondSettings: { maxWaitMs: 200, minCoveragePercent: 0 },
      secondMethod: { retrievalMethod: "multi-view-vector" },
      debugSettings: { maxWaitMs: 100, minCoveragePercent: 0 },
    });
  }));
