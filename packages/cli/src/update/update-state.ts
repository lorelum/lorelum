import { Database } from "bun:sqlite";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateChannel } from "./version-catalog.js";

export const UPDATE_SUCCESS_TTL_MS = 60 * 60 * 1_000;
export const UPDATE_FAILURE_COOLDOWN_MS = 15 * 60 * 1_000;

export interface UpdateCheckKey {
  readonly channel: UpdateChannel;
  readonly target: string;
  readonly currentVersion: string;
}

export interface AutoUpdateState {
  /** undefined means no fresh successful check; null is a fresh check with no candidate. */
  readReady(key: UpdateCheckKey, now: number): string | null | undefined;
  reserveCheck(key: UpdateCheckKey, now: number, token: string): boolean;
  reservationMatches(key: UpdateCheckKey, token: string): boolean;
  finishCheck(
    key: UpdateCheckKey,
    token: string,
    candidateVersion: string | null,
    checkedAt: number,
  ): boolean;
  failCheck(key: UpdateCheckKey, token: string, failedAt: number): boolean;
  claimNotice(currentVersion: string, targetVersion: string, claimedAt: number): boolean;
  close(): void;
}

interface CheckRow {
  readonly checked_at: number | null;
  readonly next_check_at: number;
  readonly candidate_version: string | null;
  readonly reservation_token: string | null;
}

type CheckBindings = Record<string, string | number | null>;

const schemaVersion = 1;
const checkColumns = "channel, target, current_version";

/** Opens the user's update ledger. Existing unreadable or foreign schemas are never repaired. */
export async function openUpdateState(rootDirectory: string): Promise<AutoUpdateState> {
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const path = join(rootDirectory, "updates.sqlite");
  try {
    const file = await open(path, "wx", 0o600);
    await file.close();
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  const database = new Database(path, { create: true, strict: true });
  try {
    database.exec("PRAGMA busy_timeout = 0");
    initializeOrVerifySchema(database);
    return createState(database);
  } catch (error) {
    database.close(true);
    throw error;
  }
}

function initializeOrVerifySchema(database: Database): void {
  const row = database.query("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version === schemaVersion) return;
  if (row.user_version !== 0) throw new Error("update state schema version is not recognized");
  const tables = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  if (tables.length !== 0) throw new Error("unversioned update state is not empty");

  transaction(database, () => {
    database.exec(`
      CREATE TABLE checks (
        channel TEXT NOT NULL,
        target TEXT NOT NULL,
        current_version TEXT NOT NULL,
        checked_at INTEGER,
        next_check_at INTEGER NOT NULL,
        candidate_version TEXT,
        reservation_token TEXT,
        PRIMARY KEY (channel, target, current_version)
      ) STRICT;
      CREATE TABLE notified_pairs (
        current_version TEXT NOT NULL,
        target_version TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (current_version, target_version)
      ) STRICT;
      PRAGMA user_version = 1;
    `);
  });
}

function createState(database: Database): AutoUpdateState {
  const selectCheck = database.query<CheckRow, CheckBindings>(
    `SELECT checked_at, next_check_at, candidate_version, reservation_token
     FROM checks WHERE channel = $channel AND target = $target AND current_version = $currentVersion`,
  );
  const readReady = (key: UpdateCheckKey, now: number): string | null | undefined => {
    const row = selectCheck.get(bindKey(key));
    if (row === null) return undefined;
    if (
      row.checked_at === null ||
      now < row.checked_at ||
      now - row.checked_at >= UPDATE_SUCCESS_TTL_MS
    )
      return undefined;
    return row.candidate_version;
  };

  return {
    readReady,
    reserveCheck(key, now, token) {
      return transaction(database, () => {
        const row = selectCheck.get(bindKey(key));
        if (row !== null) {
          if (now < row.next_check_at) return false;
          database
            .query(
              `UPDATE checks SET next_check_at = $nextCheckAt, reservation_token = $token
               WHERE channel = $channel AND target = $target AND current_version = $currentVersion`,
            )
            .run({
              ...bindKey(key),
              nextCheckAt: now + UPDATE_FAILURE_COOLDOWN_MS,
              token,
            });
          return true;
        }
        database
          .query(
            `INSERT INTO checks (${checkColumns}, checked_at, next_check_at, candidate_version, reservation_token)
             VALUES ($channel, $target, $currentVersion, NULL, $nextCheckAt, NULL, $token)`,
          )
          .run({
            ...bindKey(key),
            nextCheckAt: now + UPDATE_FAILURE_COOLDOWN_MS,
            token,
          });
        return true;
      });
    },
    reservationMatches(key, token) {
      const row = selectCheck.get(bindKey(key));
      if (row === null) return false;
      return row.reservation_token === token;
    },
    finishCheck(key, token, candidateVersion, checkedAt) {
      const result = database
        .query(
          `UPDATE checks
           SET checked_at = $checkedAt, next_check_at = $nextCheckAt,
               candidate_version = $candidateVersion, reservation_token = NULL
           WHERE channel = $channel AND target = $target AND current_version = $currentVersion
             AND reservation_token = $token`,
        )
        .run({
          ...bindKey(key),
          checkedAt,
          nextCheckAt: checkedAt + UPDATE_SUCCESS_TTL_MS,
          candidateVersion,
          token,
        });
      return result.changes === 1;
    },
    failCheck(key, token, failedAt) {
      const result = database
        .query(
          `UPDATE checks SET next_check_at = $nextCheckAt, reservation_token = NULL
           WHERE channel = $channel AND target = $target AND current_version = $currentVersion
             AND reservation_token = $token`,
        )
        .run({
          ...bindKey(key),
          nextCheckAt: failedAt + UPDATE_FAILURE_COOLDOWN_MS,
          token,
        });
      return result.changes === 1;
    },
    claimNotice(currentVersion, targetVersion, claimedAt) {
      const result = database
        .query(
          `INSERT INTO notified_pairs (current_version, target_version, claimed_at)
           VALUES ($currentVersion, $targetVersion, $claimedAt)
           ON CONFLICT(current_version, target_version) DO NOTHING`,
        )
        .run({ currentVersion, targetVersion, claimedAt });
      return result.changes === 1;
    },
    close() {
      database.close(true);
    },
  };
}

function bindKey(key: UpdateCheckKey): CheckBindings {
  return {
    channel: key.channel,
    target: key.target,
    currentVersion: key.currentVersion,
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function transaction<T>(database: Database, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The connection will be closed by its owner; preserve the original failure.
    }
    throw error;
  }
}
