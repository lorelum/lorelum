import { Database } from "bun:sqlite";
import { join } from "node:path";

import type { StorageRoot } from "./types";
import { migrateDatabase } from "./migrations";

export class StoreDatabase {
  readonly connection: Database;

  constructor(root: StorageRoot) {
    this.connection = new Database(join(root.path, "store.sqlite"), { strict: true });
    migrateDatabase(this.connection);
  }

  transaction<T>(operation: () => T): T {
    return this.connection.transaction(operation).immediate();
  }

  close(): void {
    this.connection.close();
  }
}
