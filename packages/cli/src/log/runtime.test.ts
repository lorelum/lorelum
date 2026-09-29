import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
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
    const redirected = join(directory, "redirected");
    await symlink(redirected, join(directory, "logs"));
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
    expect(notice).toContain(`symlink at ${join(directory, "logs")}`);
    expect(notice?.endsWith("\n")).toBe(true);
  }));
