/* eslint-disable no-await-in-loop -- Lock acquisition retries wait for the previous owner to release the OS lock. */
import { Database } from "bun:sqlite";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { BackendError } from "../protocol/errors";
import { assertPrivateFile, checkDirectory, hasCode } from "./runtime-state";

/** SQLite's OS-backed writer lock is released on crash; no stale PID lock reclamation. */
export async function withStartupLock<T>(
  directory: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T> {
  await checkDirectory(directory, true);
  const path = join(directory, "control.sqlite");
  if (!(await assertPrivateFile(path))) {
    try {
      const file = await open(path, "wx", 0o600);
      await file.close();
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    await assertPrivateFile(path);
  }
  const db = new Database(path, { create: true, strict: true });
  const deadline = Date.now() + timeoutMs;
  let locked = false;
  try {
    db.exec("PRAGMA busy_timeout = 0");
    while (!locked) {
      try {
        db.exec("BEGIN IMMEDIATE");
        locked = true;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "SQLITE_BUSY")
          throw new BackendError("backend.state-invalid", { cause: error });
        if (Date.now() >= deadline) throw new BackendError("backend.deadline-exceeded");
        await Bun.sleep(25);
      }
    }
    return await run();
  } finally {
    if (locked) db.exec("ROLLBACK");
    db.close();
  }
}
