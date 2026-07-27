import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { SqliteStateError } from "../errors";

import { migrateDatabase } from "./migrations";

export const SQLITE_FILE_NAME = "store.sqlite";

export function sqlitePath(rootPath: string): string {
  return join(rootPath, SQLITE_FILE_NAME);
}

/** Opens and migrates a LocalStore database; callers own the returned handle. */
export async function openStoreDatabase(rootPath: string): Promise<Database> {
  let database: Database | undefined;
  try {
    await mkdir(rootPath, { recursive: true });
    database = new Database(sqlitePath(rootPath));
    migrateDatabase(database);
    return database;
  } catch (error) {
    database?.close();
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot open LocalStore database", error);
  }
}
