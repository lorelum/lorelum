import { expect, test } from "bun:test";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { JsonlFileSink } from "./jsonl.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lorelum-jsonl-sink-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function managedPaths(root: string) {
  const logRoot = join(root, "logs");
  const path = join(logRoot, "cli", "2026-09-29", "trace.jsonl");
  return { logRoot, path };
}

function posixMode(mode: number): number {
  return mode & 0o7777;
}

test("creates a private process-owned segment and keeps concurrent records whole", async () =>
  fixture(async (root) => {
    const path = join(root, "logs", "cli", "2026-09-18", "trace.jsonl");
    const sink = new JsonlFileSink(path, join(root, "logs"));
    await Promise.all(
      Array.from({ length: 8 }, (_, sequence) =>
        sink.write({ level: "info", source: "cli", message: `event-${sequence}` }),
      ),
    );
    await sink.close();
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(8);
    expect(lines.map((line) => JSON.parse(line).message).sort()).toEqual(
      Array.from({ length: 8 }, (_, sequence) => `event-${sequence}`),
    );
    if (process.platform !== "win32") {
      expect((await lstat(dirname(path))).mode & 0o077).toBe(0);
      expect((await lstat(path)).mode & 0o077).toBe(0);
    }
    expect(sink.failure).toBeUndefined();
  }));

test.skipIf(process.platform === "win32")(
  "writes private logs below a user-owned 0755 trusted root without touching its mode",
  async () =>
    fixture(async (root) => {
      const { path } = managedPaths(root);
      await chmod(root, 0o755);
      const before = posixMode((await lstat(root)).mode);

      const sink = new JsonlFileSink(path, join(root, "logs"), root);
      await sink.write({ level: "info", source: "cli", message: "kept" });
      await sink.close();

      const record = JSON.parse(await readFile(path, "utf8"));
      expect(record.message).toBe("kept");
      expect(posixMode((await lstat(path)).mode) & 0o0777).toBe(0o600);
      const subtreeModes = await Promise.all(
        [join(root, "logs"), dirname(dirname(path)), dirname(path)].map(async (directory) =>
          posixMode((await lstat(directory)).mode),
        ),
      );
      for (const mode of subtreeModes) expect(mode & 0o077).toBe(0);
      // Guard: the trusted root's mode must not change by a single bit.
      expect(posixMode((await lstat(root)).mode)).toBe(before);
      expect(before & 0o0777).toBe(0o755);
      expect(sink.failure).toBeUndefined();
    }),
);

test.skipIf(process.platform === "win32")(
  "tightens an existing wide managed subtree and file by clearing group/other only",
  async () =>
    fixture(async (root) => {
      const { logRoot, path } = managedPaths(root);
      await chmod(root, 0o755);
      await mkdir(join(logRoot, "cli", "2026-09-29"), { recursive: true, mode: 0o755 });
      await writeFile(path, "", { mode: 0o644 });
      await chmod(join(logRoot, "cli"), 0o755);

      const sink = new JsonlFileSink(path, logRoot, root);
      await sink.write({ level: "info", source: "cli", message: "tightened" });
      await sink.close();

      const record = JSON.parse((await readFile(path, "utf8")).trimEnd());
      expect(record.message).toBe("tightened");
      // Mask tightening only ever clears group/other; owner bits are kept.
      expect(posixMode((await lstat(path)).mode) & 0o7777).toBe(0o600);
      expect(posixMode((await lstat(join(logRoot, "cli"))).mode) & 0o777).toBe(0o700);
      expect(posixMode((await lstat(root)).mode) & 0o777).toBe(0o755);
      expect(sink.failure).toBeUndefined();
    }),
);

test.skipIf(process.platform === "win32")(
  "disables itself rather than following a replaced managed directory",
  async () =>
    fixture(async (root) => {
      const redirected = join(root, "redirected");
      const path = join(root, "logs", "cli", "trace.jsonl");
      const sink = new JsonlFileSink(path, join(root, "logs"));
      await sink.write({ level: "info", source: "cli", message: "before" });
      await writeFile(redirected, "preserve me", "utf8");
      await rm(join(root, "logs", "cli"), { recursive: true });
      await symlink(redirected, join(root, "logs", "cli"));

      await expect(
        sink.write({ level: "info", source: "cli", message: "after" }),
      ).resolves.toBeUndefined();
      await sink.close();
      expect(await readFile(redirected, "utf8")).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "does not create a managed root below a symlinked Lorelum directory",
  async () =>
    fixture(async (root) => {
      const redirected = join(root, "redirected");
      const logRoot = join(root, "logs");
      await writeFile(redirected, "preserve me", "utf8");
      await symlink(redirected, logRoot);
      const sink = new JsonlFileSink(join(logRoot, "cli", "trace.jsonl"), logRoot, root);

      await expect(
        sink.write({ level: "info", source: "cli", message: "blocked" }),
      ).resolves.toBeUndefined();
      expect(await readFile(redirected, "utf8")).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "does not follow or write through a symlinked target file",
  async () =>
    fixture(async (root) => {
      const { path } = managedPaths(root);
      const redirected = join(root, "redirected.jsonl");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(redirected, "preserve me", "utf8");
      await symlink(redirected, path);

      const sink = new JsonlFileSink(path, join(root, "logs"), root);
      await expect(
        sink.write({ level: "info", source: "cli", message: "blocked" }),
      ).resolves.toBeUndefined();
      await sink.close();
      expect(await readFile(redirected, "utf8")).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "does not write through a hard-linked target file",
  async () =>
    fixture(async (root) => {
      const { path } = managedPaths(root);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, "preserve me", { mode: 0o600 });
      await link(path, join(root, "alias.jsonl"));

      const sink = new JsonlFileSink(path, join(root, "logs"), root);
      await expect(
        sink.write({ level: "info", source: "cli", message: "blocked" }),
      ).resolves.toBeUndefined();
      await sink.close();
      expect(await readFile(path, "utf8")).toBe("preserve me");
      expect(await readFile(join(root, "alias.jsonl"), "utf8")).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "refuses a managed directory whose owner bits are insufficient instead of repairing it",
  async () =>
    fixture(async (root) => {
      const { logRoot, path } = managedPaths(root);
      // 0505: no owner write, so the segment cannot serve the sink, and a
      // repair must never add owner bits — the location must be refused.
      await mkdir(logRoot, { mode: 0o505 });

      const sink = new JsonlFileSink(path, logRoot, root);
      await expect(
        sink.write({ level: "info", source: "cli", message: "blocked" }),
      ).resolves.toBeUndefined();
      await sink.close();
      expect(posixMode((await lstat(logRoot)).mode) & 0o7777).toBe(0o505);
      await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }),
);

test.skipIf(process.platform === "win32")(
  "exposes the first failure category for the invocation notice",
  async () =>
    fixture(async (root) => {
      const redirected = join(root, "redirected");
      const logRoot = join(root, "logs");
      await writeFile(redirected, "preserve me", "utf8");
      await symlink(redirected, logRoot);
      const sink = new JsonlFileSink(join(logRoot, "cli", "trace.jsonl"), logRoot, root);

      await expect(
        sink.write({ level: "info", source: "cli", message: "first" }),
      ).resolves.toBeUndefined();
      await expect(
        sink.write({ level: "info", source: "cli", message: "second" }),
      ).resolves.toBeUndefined();
      await sink.close();

      expect(sink.failure).toEqual({ category: "symlink", path: logRoot });
      expect(await readFile(redirected, "utf8")).toBe("preserve me");
    }),
);
