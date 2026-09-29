import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateManagedTarget,
  ManagedLogLocationError,
  walkManagedLocation,
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
    ).toEqual({ verdict: "safe" });
    expect(
      evaluateManagedTarget(facts({ isDirectory: false, isFile: true, mode: 0o0600 }), "file", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "safe" });
  });

  test("repairable for a user-owned target with widened group/other bits", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o0755 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "repairable", mode: 0o700 });
    expect(
      evaluateManagedTarget(facts({ isDirectory: false, isFile: true, mode: 0o0644 }), "file", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "repairable", mode: 0o600 });
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
    ).toEqual({ verdict: "unsafe", reason: "owner-bits-insufficient" });
    expect(
      evaluateManagedTarget(facts({ isDirectory: false, isFile: true, mode: 0o0044 }), "file", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "unsafe", reason: "owner-bits-insufficient" });
  });

  test("unsafe for symlink and wrong type", () => {
    expect(evaluateManagedTarget(facts({ isSymbolicLink: true }), "directory")).toEqual({
      verdict: "unsafe",
      reason: "symlink",
    });
    expect(evaluateManagedTarget(facts({ isDirectory: false, isFile: true }), "directory")).toEqual(
      { verdict: "unsafe", reason: "wrong-type" },
    );
    expect(evaluateManagedTarget(facts(), "file", { currentUid: 1000, platform: "linux" })).toEqual(
      { verdict: "unsafe", reason: "wrong-type" },
    );
  });

  test("hard links disqualify only files; directories legitimately hold subdirectories", () => {
    expect(
      evaluateManagedTarget(
        facts({ isDirectory: false, isFile: true, nlink: 2, mode: 0o0600 }),
        "file",
        { currentUid: 1000, platform: "linux" },
      ),
    ).toEqual({ verdict: "unsafe", reason: "multiple-links" });
    expect(
      evaluateManagedTarget(facts({ nlink: 3 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "safe" });
  });

  test("unsafe when the target is not owned by the current user", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o0700, uid: 0 }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "unsafe", reason: "foreign-owner" });
    expect(
      evaluateManagedTarget(facts({ mode: 0o0700, uid: undefined }), "directory", {
        currentUid: 1000,
        platform: "linux",
      }),
    ).toEqual({ verdict: "unsafe", reason: "foreign-owner" });
  });

  test("win32 applies structural checks only", () => {
    expect(
      evaluateManagedTarget(facts({ mode: 0o0777, uid: 0 }), "directory", {
        currentUid: 1000,
        platform: "win32",
      }),
    ).toEqual({ verdict: "safe" });
    expect(
      evaluateManagedTarget(facts({ isSymbolicLink: true }), "directory", {
        platform: "win32",
      }),
    ).toEqual({ verdict: "unsafe", reason: "symlink" });
    expect(
      evaluateManagedTarget(facts({ isDirectory: false, isFile: true }), "directory", {
        platform: "win32",
      }),
    ).toEqual({ verdict: "unsafe", reason: "wrong-type" });
    expect(
      evaluateManagedTarget(
        facts({ isDirectory: false, isFile: true, nlink: 2, mode: 0o0600 }),
        "file",
        { platform: "win32" },
      ),
    ).toEqual({ verdict: "unsafe", reason: "multiple-links" });
  });
});

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lorelum-safety-walk-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fullMode(mode: number): number {
  return mode & 0o7777;
}

test.skipIf(process.platform === "win32")(
  "creates the missing managed chain private below a 0755 trusted root, leaving the root untouched",
  async () =>
    fixture(async (root) => {
      await mkdir(join(root, "lorelum-root"), { mode: 0o755 });
      const trusted = join(root, "lorelum-root");
      const before = fullMode((await lstat(trusted)).mode);

      await walkManagedLocation(trusted, join(trusted, "logs", "cli", "2026-09-29"));

      expect(fullMode((await lstat(trusted)).mode)).toBe(before);
      expect(before & 0o0777).toBe(0o755);
      for (const segment of ["logs", "logs/cli", "logs/cli/2026-09-29"]) {
        expect(fullMode((await lstat(join(trusted, segment))).mode) & 0o0777).toBe(0o700);
      }
    }),
);

test.skipIf(process.platform === "win32")(
  "tightens wide managed segments while the trusted root stays bit-for-bit unchanged",
  async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum-root");
      await mkdir(join(trusted, "logs", "cli"), { recursive: true, mode: 0o755 });
      await chmod(trusted, 0o755);
      const before = fullMode((await lstat(trusted)).mode);

      await walkManagedLocation(trusted, join(trusted, "logs", "cli"));

      expect(fullMode((await lstat(trusted)).mode)).toBe(before);
      expect(fullMode((await lstat(join(trusted, "logs"))).mode) & 0o0777).toBe(0o700);
      expect(fullMode((await lstat(join(trusted, "logs", "cli"))).mode) & 0o0777).toBe(0o700);
    }),
);

test.skipIf(process.platform === "win32")(
  "creates a missing trusted root private and still manages the chain below it",
  async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum-root");

      await walkManagedLocation(trusted, join(trusted, "logs"));

      expect(fullMode((await lstat(trusted)).mode) & 0o0777).toBe(0o700);
      expect(fullMode((await lstat(join(trusted, "logs"))).mode) & 0o0777).toBe(0o700);
    }),
);

test.skipIf(process.platform === "win32")(
  "refuses a symlinked trusted root without following it",
  async () =>
    fixture(async (root) => {
      const redirected = join(root, "redirected");
      await writeFile(redirected, "preserve me", "utf8");
      const trusted = join(root, "lorelum-root");
      await symlink(redirected, trusted);

      await expect(walkManagedLocation(trusted, join(trusted, "logs"))).rejects.toMatchObject({
        reason: "symlink",
        path: trusted,
      });
      expect(await readFile(redirected, "utf8")).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")("refuses a non-directory trusted root", async () =>
  fixture(async (root) => {
    const trusted = join(root, "lorelum-root");
    await writeFile(trusted, "not a directory", "utf8");

    await expect(walkManagedLocation(trusted, join(trusted, "logs"))).rejects.toMatchObject({
      reason: "wrong-type",
      path: trusted,
    });
  }),
);

test.skipIf(process.platform === "win32")(
  "refuses a symlinked managed segment without following it",
  async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum-root");
      const redirected = join(root, "redirected");
      await mkdir(trusted, { mode: 0o700 });
      await mkdir(redirected, { mode: 0o700 });
      await writeFile(join(redirected, "sentinel"), "preserve me", "utf8");
      await symlink(redirected, join(trusted, "logs"));

      await expect(
        walkManagedLocation(trusted, join(trusted, "logs", "cli")),
      ).rejects.toBeInstanceOf(ManagedLogLocationError);
      expect(await readFile(join(redirected, "sentinel"), "utf8")).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "refuses a managed segment position held by a regular file",
  async () =>
    fixture(async (root) => {
      const trusted = join(root, "lorelum-root");
      await mkdir(trusted, { mode: 0o700 });
      await writeFile(join(trusted, "logs"), "not a directory", "utf8");

      await expect(
        walkManagedLocation(trusted, join(trusted, "logs", "cli")),
      ).rejects.toMatchObject({
        reason: "wrong-type",
        path: join(trusted, "logs"),
      });
    }),
);

test("rejects a target that escapes the trusted root", async () =>
  fixture(async (root) => {
    const trusted = join(root, "lorelum-root");
    await mkdir(trusted, { mode: 0o700 });

    await expect(walkManagedLocation(trusted, join(root, "outside"))).rejects.toThrow(
      "escaped its root",
    );
  }));
