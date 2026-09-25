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
  }));

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
      expect(sink.outcome.status).toBe("unavailable");
      expect(sink.outcome.failure?.kind).toBe("location-unavailable");
    }),
);

test.skipIf(process.platform === "win32")(
  "tightens a user-owned 0755 managed chain and persists the trace",
  async () =>
    fixture(async (root) => {
      const lorelum = join(root, "home", ".lorelum");
      const logRoot = join(lorelum, "logs");
      const path = join(logRoot, "cli", "2026-09-23", "trace.jsonl");
      await mkdir(join(logRoot, "cli"), { recursive: true });
      await chmod(lorelum, 0o755);
      await chmod(logRoot, 0o755);
      await chmod(join(logRoot, "cli"), 0o755);
      const sink = new JsonlFileSink(path, logRoot, lorelum);

      await sink.write({ level: "info", source: "cli", message: "healed" });
      await sink.close();

      expect((await readFile(path, "utf8")).includes("healed")).toBe(true);
      for (const dir of [
        lorelum,
        logRoot,
        join(logRoot, "cli"),
        join(logRoot, "cli", "2026-09-23"),
      ]) {
        expect((await lstat(dir)).mode & 0o077).toBe(0);
      }
      expect(sink.outcome.status).toBe("ready");
      const repairs = sink.outcome.repairs;
      expect(repairs.length).toBeGreaterThanOrEqual(3);
      expect(repairs.every((repair) => repair.kind === "directory")).toBe(true);
      expect(repairs.every((repair) => ((repair.beforeMode ?? 0) & 0o777) === 0o755)).toBe(true);
      expect(repairs.every((repair) => ((repair.afterMode ?? 0) & 0o777) === 0o700)).toBe(true);
    }),
);

test.skipIf(process.platform === "win32")(
  "tightens a widened existing segment file before appending",
  async () =>
    fixture(async (root) => {
      const logRoot = join(root, "logs");
      const path = join(logRoot, "cli", "trace.jsonl");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, '{"level":"info"}\n', { mode: 0o644 });
      const sink = new JsonlFileSink(path, logRoot, root);

      await sink.write({ level: "info", source: "cli", message: "appended" });
      await sink.close();

      expect((await lstat(path)).mode & 0o777).toBe(0o600);
      expect((await readFile(path, "utf8")).includes("appended")).toBe(true);
      expect(sink.outcome.status).toBe("ready");
      const repair = sink.outcome.repairs.find((entry) => entry.kind === "file");
      expect((repair?.beforeMode ?? 0) & 0o777).toBe(0o644);
      expect((repair?.afterMode ?? 0) & 0o777).toBe(0o600);
    }),
);

test.skipIf(process.platform === "win32")(
  "refuses a multi-linked segment file without touching it",
  async () =>
    fixture(async (root) => {
      const logRoot = join(root, "logs");
      const path = join(logRoot, "cli", "trace.jsonl");
      const twin = join(root, "twin.jsonl");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, "preserve me\n", { mode: 0o644 });
      await link(path, twin);
      const sink = new JsonlFileSink(path, logRoot, root);

      await expect(
        sink.write({ level: "info", source: "cli", message: "blocked" }),
      ).resolves.toBeUndefined();
      await sink.close();

      expect(await readFile(path, "utf8")).toBe("preserve me\n");
      expect((await lstat(path)).mode & 0o777).toBe(0o644);
      expect((await lstat(twin)).nlink).toBe(2);
      expect(sink.outcome.status).toBe("unavailable");
      expect(sink.outcome.failure).toEqual({
        kind: "location-unavailable",
        reason: "multiple-links",
        path,
      });
    }),
);

test.skipIf(process.platform === "win32")(
  "does not add owner permissions for a 0505 managed directory",
  async () =>
    fixture(async (root) => {
      const lorelum = join(root, "home", ".lorelum");
      const logRoot = join(lorelum, "logs");
      const path = join(logRoot, "cli", "trace.jsonl");
      await mkdir(join(logRoot, "cli"), { recursive: true, mode: 0o700 });
      await chmod(lorelum, 0o505);
      const sink = new JsonlFileSink(path, logRoot, lorelum);

      await expect(
        sink.write({ level: "info", source: "cli", message: "blocked" }),
      ).resolves.toBeUndefined();
      await sink.close();

      expect((await lstat(lorelum)).mode & 0o777).toBe(0o505);
      expect(sink.outcome.status).toBe("unavailable");
      expect(sink.outcome.failure).toEqual({
        kind: "location-unavailable",
        reason: "owner-bits-insufficient",
        path: lorelum,
      });
      // Restore writability so the shared fixture cleanup can remove the tree.
      await chmod(lorelum, 0o700);
    }),
);
