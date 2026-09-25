import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, open, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateManagedTarget,
  inspectAndTightenDirectory,
  inspectAndTightenExistingFile,
  inspectAndTightenHandle,
  ManagedLogLocationError,
  walkManagedLocation,
  type ManagedRepairFact,
  type ManagedTargetFacts,
} from "./safety.js";

function facts(overrides: Partial<ManagedTargetFacts> = {}): ManagedTargetFacts {
  return {
    isSymbolicLink: false,
    isDirectory: true,
    isFile: false,
    nlink: 1,
    mode: 0o0700,
    uid: 1000,
    ...overrides,
  };
}

describe("evaluateManagedTarget", () => {
  test("safe when private and owner bits suffice", () => {
    expect(
      evaluateManagedTarget(facts(), "directory", { currentUid: 1000, platform: "linux" }),
    ).toEqual({
      verdict: "safe",
    });
  });

  test("repairable for a user-owned directory with widened group/other bits", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o0755 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "repairable", mode: 0o700 });
  });

  test("tightening preserves special bits and never sets a fixed target mode", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o2755 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "repairable", mode: 0o2700 });
  });

  test("never repairable when owner bits would have to be added", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o0505 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({
      verdict: "unsafe",
      reason: "owner-bits-insufficient",
    });
    expect(
      evaluateManagedTarget(facts({ isDirectory: false, isFile: true, mode: 0o0044 }), "file", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "unsafe", reason: "owner-bits-insufficient" });
  });

  test("unsafe for symlink, wrong type, extra hard links, and foreign owners", () => {
    expect(evaluateManagedTarget(facts({ isSymbolicLink: true }), "directory")).toEqual({
      verdict: "unsafe",
      reason: "symlink",
    });
    expect(evaluateManagedTarget(facts({ isDirectory: false, isFile: true }), "directory")).toEqual(
      {
        verdict: "unsafe",
        reason: "wrong-type",
      },
    );
    expect(
      evaluateManagedTarget(
        facts({ isDirectory: false, isFile: true, nlink: 2, mode: 0o0600 }),
        "file",
        {
          currentUid: 1000,
          platform: "linux",
        },
      ),
    ).toEqual({ verdict: "unsafe", reason: "multiple-links" });
    expect(
      evaluateManagedTarget(facts({ mode: 0o0755 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "repairable", mode: 0o700 });
    expect(
      evaluateManagedTarget(facts({ mode: 0o0755, uid: 0 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "unsafe", reason: "foreign-owner" });
    expect(
      evaluateManagedTarget(facts({ mode: 0o0755, uid: undefined }), "directory", {
        platform: "linux",
      }),
    ).toEqual({
      verdict: "unsafe",
      reason: "foreign-owner",
    });
  });

  test("windows degrades to structural checks only", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o0777, uid: undefined }), "directory", {
        platform: "win32",
      }),
    ).toEqual({ verdict: "safe" });
    expect(
      evaluateManagedTarget(facts({ isSymbolicLink: true }), "directory", { platform: "win32" }),
    ).toEqual({ verdict: "unsafe", reason: "symlink" });
  });
});

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lorelum-safety-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === "win32")("inspect and tighten", () => {
  test("tightens a widened user-owned directory through its descriptor", async () =>
    fixture(async (root) => {
      const dir = join(root, "managed");
      await mkdirMode(dir, 0o755);
      const result = await inspectAndTightenDirectory(dir);
      expect(result?.verdict).toEqual({ verdict: "safe" });
      expect(result?.repair?.kind).toBe("directory");
      expect((result?.repair?.beforeMode ?? 0) & 0o777).toBe(0o755);
      expect((result?.repair?.afterMode ?? 0) & 0o777).toBe(0o700);
      expect((await lstat(dir)).mode & 0o077).toBe(0);
    }));

  test("leaves an already private directory untouched", async () =>
    fixture(async (root) => {
      const dir = join(root, "managed");
      await mkdirMode(dir, 0o700);
      const result = await inspectAndTightenDirectory(dir);
      expect(result?.verdict).toEqual({ verdict: "safe" });
      expect(result?.repair).toBeUndefined();
    }));

  test("a path replaced after open cannot redirect the tighten", async () =>
    fixture(async (root) => {
      const original = join(root, "managed");
      const decoyContent = join(root, "decoy-content");
      await mkdirMode(original, 0o755);
      await writeFile(decoyContent, "preserve me", "utf8");
      const handle = await open(original, "r");
      try {
        // Replace the path after the descriptor is open but before tightening.
        await rm(original, { recursive: true });
        await symlink(decoyContent, original);
        const result = await inspectAndTightenHandle(handle, original, "directory");
        expect(result.verdict).toEqual({ verdict: "safe" });
        expect((result.repair?.beforeMode ?? 0) & 0o777).toBe(0o755);
        // The symlink target (a regular file) is untouched and still readable.
        expect(await Bun.file(decoyContent).text()).toBe("preserve me");
        expect((await lstat(original)).isSymbolicLink()).toBe(true);
      } finally {
        await handle.close();
      }
    }));

  test("reports a symlinked directory as an explicit unsafe rejection", async () =>
    fixture(async (root) => {
      const target = join(root, "real");
      await mkdirMode(target, 0o700);
      const link = join(root, "link");
      await symlink(target, link);
      await expect(inspectAndTightenDirectory(link)).rejects.toBeInstanceOf(
        ManagedLogLocationError,
      );
      expect((await lstat(target)).mode & 0o077).toBe(0);
    }));

  test("inspects an existing widened file and returns undefined when missing", async () =>
    fixture(async (root) => {
      const file = join(root, "segment.jsonl");
      expect(await inspectAndTightenExistingFile(file)).toBeUndefined();
      await writeFile(file, "{}\n", { mode: 0o644 });
      const result = await inspectAndTightenExistingFile(file);
      expect((result?.repair?.afterMode ?? 0) & 0o777).toBe(0o600);
      expect((await lstat(file)).mode & 0o077).toBe(0);
      await unlink(file);
    }));
});

describe.skipIf(process.platform === "win32")("walkManagedLocation", () => {
  test("createMissing false never creates, not even the trusted directory", async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum");
      const target = join(trusted, "logs", "backend");
      const repairs: ManagedRepairFact[] = [];
      await expect(
        walkManagedLocation(trusted, target, { createMissing: false }, repairs),
      ).resolves.toEqual([]);
      expect(repairs).toEqual([]);
      await expect(lstat(trusted)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    }));

  test("createMissing false tightens an existing widened chain without creating anything", async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum");
      const target = join(trusted, "logs", "backend");
      await mkdirMode(trusted, 0o755);
      await mkdirMode(join(trusted, "logs"), 0o755);
      const repairs = await walkManagedLocation(trusted, target, { createMissing: false });
      expect(repairs.map((repair) => repair.path)).toEqual([trusted, join(trusted, "logs")]);
      expect((await lstat(trusted)).mode & 0o077).toBe(0);
      // The missing final segment stays missing.
      await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    }));

  test("rejects a target that escapes its trusted root", async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum");
      await expect(
        walkManagedLocation(trusted, join(root, "elsewhere"), { createMissing: false }),
      ).rejects.toThrow("escaped its root");
    }));

  test("createMissing true establishes the chain with the private mode and stays idempotent", async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum");
      const target = join(trusted, "logs", "cli");
      await walkManagedLocation(trusted, target, { createMissing: true });
      expect((await lstat(trusted)).mode & 0o777).toBe(0o700);
      expect((await lstat(target)).mode & 0o777).toBe(0o700);
      const second = await walkManagedLocation(trusted, target, { createMissing: true });
      expect(second).toEqual([]);
    }));
});

async function mkdirMode(path: string, mode: number): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { mode });
  await chmod(path, mode);
}
