/* eslint-disable no-await-in-loop -- Rotation fixtures write and inspect one file at a time. */
import { expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPrivateJsonlSink, PrivateJsonlSink } from "./private-jsonl-sink";

async function fixture(run: (directory: string) => Promise<void>) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-private-jsonl-")));
  const directory = join(parent, "runtime");
  try {
    await run(directory);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function event(sequence: number) {
  return {
    time: new Date(0).toISOString(),
    level: "info" as const,
    component: "backend" as const,
    event: "backend.daemon.ready" as const,
    code: `event-${sequence}-${"x".repeat(64)}`,
  };
}

test("preflight creates a private target and writes one JSON line per event", async () =>
  fixture(async (directory) => {
    const sink = await createPrivateJsonlSink({ directory, maxFileBytes: 512, maxFiles: 2 });
    await Promise.all([sink.write(event(1)), sink.write(event(2)), sink.write(event(3))]);
    await sink.close();

    const files = ["backend.log.1", "backend.log"];
    const lines = (
      await Promise.all(
        files.map(async (file) => {
          const text = await readFile(join(directory, file), "utf8");
          return text
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as { context?: { code?: string } });
        }),
      )
    ).flat();
    expect(lines.map((line) => line.context?.code)).toEqual([
      `event-1-${"x".repeat(64)}`,
      `event-2-${"x".repeat(64)}`,
      `event-3-${"x".repeat(64)}`,
    ]);
  }));

test("rotation keeps a hard file-count and per-file byte bound", async () =>
  fixture(async (directory) => {
    const sink = await createPrivateJsonlSink({ directory, maxFileBytes: 256, maxFiles: 3 });
    for (let sequence = 0; sequence < 20; sequence += 1) await sink.write(event(sequence));
    await sink.close();

    const files = (await readdir(directory)).filter((name) => name.startsWith("backend.log"));
    expect(files.sort()).toEqual(["backend.log", "backend.log.1", "backend.log.2"]);
    for (const file of files) {
      const bytes = (await readFile(join(directory, file))).byteLength;
      expect(bytes).toBeLessThanOrEqual(256);
    }
    expect(files.length * 256).toBeLessThanOrEqual(768);
  }));

test("unsafe existing targets are rejected during preflight", async () =>
  fixture(async (directory) => {
    await rm(directory, { recursive: true, force: true });
    await rm(join(directory, "backend.log"), { force: true });
    // Create the directory through the sink's normal preflight path first.
    const safe = await createPrivateJsonlSink({ directory });
    await safe.write(event(0));
    await safe.close();
    const elsewhere = join(directory, "elsewhere");
    await writeFile(elsewhere, "not a sink", { mode: 0o600 });
    await rm(join(directory, "backend.log"));
    await symlink(elsewhere, join(directory, "backend.log"));

    const sink = new PrivateJsonlSink({ directory });
    await expect(sink.preflight()).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
    await expect(sink.preflight()).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));

test.skipIf(process.platform === "win32")(
  "permissive existing targets are rejected during preflight",
  async () =>
    fixture(async (directory) => {
      const sink = await createPrivateJsonlSink({ directory });
      await sink.write(event(0));
      await sink.close();
      await chmod(join(directory, "backend.log"), 0o644);
      await expect(new PrivateJsonlSink({ directory }).preflight()).rejects.toMatchObject({
        code: "backend.state-invalid",
      });
    }),
);

test("ordinary I/O failure after preflight disables the sink and resolves", async () =>
  fixture(async (directory) => {
    const sink = await createPrivateJsonlSink({ directory });
    await rm(directory, { recursive: true, force: true });
    await expect(sink.write(event(1))).resolves.toBeUndefined();
    expect(sink.disabled).toBe(true);
  }));

test("safe stale rotations are removed during preflight", async () =>
  fixture(async (directory) => {
    const sink = await createPrivateJsonlSink({ directory, maxFiles: 2 });
    await sink.close();
    await writeFile(join(directory, "backend.log.2"), "stale\n", { mode: 0o600 });
    const refreshed = await createPrivateJsonlSink({ directory, maxFiles: 2 });
    await refreshed.close();
    expect(await Bun.file(join(directory, "backend.log.2")).exists()).toBe(false);
  }));

test("retains only declared bounded local evidence in private JSONL", async () =>
  fixture(async (directory) => {
    const traceId = "00000000-0000-4000-8000-000000000031" as never;
    const sink = await createPrivateJsonlSink({ directory, maxFileBytes: 16_384 });
    const requestEvent = {
      time: new Date(0).toISOString(),
      level: "error" as const,
      component: "backend" as const,
      event: "backend.request.failed" as const,
      traceId,
      requestId: "request-1",
      route: "query" as const,
      query: "Practice input",
      rawError: "/absolute/path\r\nUnhandled local error",
      authorization: "Bearer must-not-serialize",
      cookie: "session=must-not-serialize",
    };
    await sink.write(requestEvent);
    await sink.write({
      time: new Date(0).toISOString(),
      level: "error",
      component: "backend",
      event: "native.exited-before-ready",
      nativeRunId: "native-run-1",
      readiness: "failed",
      stdoutBytes: 12,
      stderrBytes: 0,
      modelPath: "/absolute/model.gguf",
      nativeOutput: "raw native output",
    });
    await sink.close();
    const serialized = await readFile(join(directory, "backend.log"), "utf8");
    expect(serialized).toContain("Practice input");
    expect(serialized).toContain("/absolute/path\\r\\nUnhandled local error");
    expect(serialized).toContain("/absolute/model.gguf");
    expect(serialized).toContain("raw native output");
    expect(serialized).not.toContain("must-not-serialize");
  }));
