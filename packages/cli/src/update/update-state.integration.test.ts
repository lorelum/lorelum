import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutoUpdateService } from "./auto-check.js";
import {
  openUpdateState,
  UPDATE_FAILURE_COOLDOWN_MS,
  UPDATE_SUCCESS_TTL_MS,
  type UpdateCheckKey,
} from "./update-state.js";

const key: UpdateCheckKey = {
  channel: "prerelease",
  target: "darwin-arm64",
  currentVersion: "0.1.0-alpha.6",
};

test("caches successful candidates for one hour and keeps a new current version independent", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-update-state-"));
  const now = 1_000_000;
  const state = await openUpdateState(root);
  try {
    expect(state.readReady(key, now)).toBeUndefined();
    expect(state.reserveCheck(key, now, "token-1")).toBe(true);
    expect(state.reservationMatches(key, "token-1")).toBe(true);
    expect(state.reserveCheck(key, now + 1, "token-2")).toBe(false);
    expect(state.finishCheck(key, "token-1", "0.1.1", now + 2)).toBe(true);
    expect(state.readReady(key, now + 2)).toBe("0.1.1");
    expect(state.readReady(key, now + 2 + UPDATE_SUCCESS_TTL_MS - 1)).toBe("0.1.1");
    expect(state.readReady(key, now + 2 + UPDATE_SUCCESS_TTL_MS)).toBeUndefined();

    const nextCurrent = { ...key, currentVersion: "0.1.0-alpha.7" };
    expect(state.readReady(nextCurrent, now + 3)).toBeUndefined();
    expect(state.reserveCheck(nextCurrent, now + 3, "token-3")).toBe(true);
  } finally {
    state.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("failed checks cool down for fifteen minutes and notice pairs are atomically unique", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-update-state-"));
  const now = 2_000_000;
  const first = await openUpdateState(root);
  const second = await openUpdateState(root);
  try {
    expect(first.reserveCheck(key, now, "token-1")).toBe(true);
    expect(first.failCheck(key, "token-1", now + 2_000)).toBe(true);
    expect(second.reserveCheck(key, now + 2_000 + UPDATE_FAILURE_COOLDOWN_MS - 1, "token-2")).toBe(
      false,
    );
    expect(second.reserveCheck(key, now + 2_000 + UPDATE_FAILURE_COOLDOWN_MS, "token-3")).toBe(
      true,
    );
    expect(first.finishCheck(key, "token-1", "0.1.2", now + 3_000_000)).toBe(false);
    expect(first.failCheck(key, "token-1", now + 3_000_000)).toBe(false);
    expect(first.reservationMatches(key, "token-3")).toBe(true);
    expect(first.finishCheck(key, "token-3", "0.1.2", now + 3_000_001)).toBe(true);
    expect(first.readReady(key, now + 3_000_001)).toBe("0.1.2");

    expect(first.claimNotice(key.currentVersion, "0.1.1", now)).toBe(true);
    expect(second.claimNotice(key.currentVersion, "0.1.1", now + 1)).toBe(false);
    expect(second.claimNotice(key.currentVersion, "0.1.2", now + 2)).toBe(true);
  } finally {
    first.close();
    second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a database reservation remains busy/nonblocking and always closes the sidecar", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-update-state-busy-"));
  const initialized = await openUpdateState(root);
  initialized.close();
  const blocker = new Database(join(root, "updates.sqlite"));
  blocker.exec("BEGIN IMMEDIATE");
  let started = 0;
  let closed = 0;
  const service = createAutoUpdateService({
    rootDirectory: root,
    now: () => 3_000_000,
    currentVersion: key.currentVersion,
    target: () => key.target,
    readConfig: async () => ({ updates: { autoCheck: true } }),
    startWorker() {
      started++;
    },
    async openState(directory) {
      const state = await openUpdateState(directory);
      return {
        ...state,
        close() {
          closed++;
          state.close();
        },
      };
    },
  });
  let locked = true;
  try {
    const startedAt = performance.now();
    await expect(service.poll(true)).resolves.toBeUndefined();
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(started).toBe(0);
    expect(closed).toBe(1);
    blocker.exec("ROLLBACK");
    locked = false;
    const observer = new Database(join(root, "updates.sqlite"), { readonly: true });
    try {
      const row = observer.query("SELECT count(*) AS count FROM notified_pairs").get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    } finally {
      observer.close();
    }
  } finally {
    if (locked) blocker.exec("ROLLBACK");
    blocker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a notified version pair stays deduplicated after reopening the user state", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-update-state-persistent-"));
  const first = await openUpdateState(root);
  try {
    expect(first.claimNotice(key.currentVersion, "0.1.1", 4_000_000)).toBe(true);
  } finally {
    first.close();
  }
  const reopened = await openUpdateState(root);
  try {
    expect(reopened.claimNotice(key.currentVersion, "0.1.1", 4_000_001)).toBe(false);
  } finally {
    reopened.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown and damaged state files are rejected without replacing their contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-update-state-"));
  try {
    const unknownPath = join(root, "updates.sqlite");
    const unknown = new Database(unknownPath);
    unknown.exec("PRAGMA user_version = 99");
    unknown.close();
    await chmod(unknownPath, 0o600);
    await expect(openUpdateState(root)).rejects.toThrow("schema version is not recognized");
    const observer = new Database(unknownPath, { readonly: true });
    try {
      expect(
        (observer.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(99);
    } finally {
      observer.close();
    }

    const damagedRoot = await mkdtemp(join(tmpdir(), "lore-update-damaged-"));
    const damagedPath = join(damagedRoot, "updates.sqlite");
    await writeFile(damagedPath, "not a sqlite database");
    await chmod(damagedPath, 0o600);
    const original = await readFile(damagedPath);
    await expect(openUpdateState(damagedRoot)).rejects.toThrow();
    expect(await readFile(damagedPath)).toEqual(original);
    await rm(damagedRoot, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
