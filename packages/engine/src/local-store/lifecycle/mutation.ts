import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { EffectivePractice, PracticeSource } from "../model";
import { acquireMutationLock } from "../storage/mutation-lock";
import { openStoreDatabase } from "../storage/sqlite/database";
import { SqliteStateError, StoreBusyError, StoreRecoveryRequiredError } from "../storage/errors";
import { openLocalStore } from "./open";
import { runStoreRecovery, type RecoveryResult } from "./recovery";
import {
  deletePendingRevisionNotification,
  readPendingRevisionNotifications,
} from "../storage/sqlite/revision-outbox";
import type { EffectiveRevisionHook } from "./types";

export interface MutationContext {
  database: Database;
  recovery: RecoveryResult;
}

export interface MutationLockOptions {
  /** Bounded wait for a held lock before StoreBusyError (default 5s). */
  waitMs?: number;
  /** Test seam for proving the lock is released when database open fails. */
  openDatabase?: ((rootPath: string) => Promise<Database>) | undefined;
}

/**
 * Materialize the active source set from the materialized snapshot. The
 * reader already re-canonicalized every row, so the sources handed to the
 * pure merge rules are trusted.
 */
export function activeSources(
  effectivePractices: readonly EffectivePractice[],
): readonly PracticeSource[] {
  return effectivePractices.flatMap((practice) => practice.sources);
}

/**
 * Run one manifest-mutating operation under the cross-process mutation lock
 * (ADR 0007 §12). Sequencing is frozen by the ADR:
 *
 * Acquire the lock before any recovery side effect. `runStoreRecovery` may
 * rewrite the manifest and remove journals, so running it before the lock can
 * roll back a live writer. The lock owner always performs recovery before the
 * mutation callback is allowed to write new state.
 *
 * The lock and the database handle are always released, even when `run`
 * throws.
 */
export async function withStoreMutation<T>(
  rootPath: string,
  run: (context: MutationContext) => Promise<T>,
  options: MutationLockOptions = {},
): Promise<T> {
  // A first install may target the default `~/.lorelum` before it exists.
  // Directory creation is idempotent and must precede atomic lock-file create;
  // recovery and every other store side effect still remain under the lock.
  await mkdir(rootPath, { recursive: true });
  const lock = await acquireMutationLock(rootPath, {
    ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
  });
  let database: Database | undefined;
  try {
    try {
      database = await (options.openDatabase ?? openStoreDatabase)(rootPath);
    } catch (error) {
      if (error instanceof SqliteStateError) {
        throw new StoreRecoveryRequiredError(`SQLite is missing or corrupt: ${error.message}`);
      }
      throw error;
    }
    const recovery = await runStoreRecovery(rootPath, database);
    // Recovery is complete and the writer lock makes this verification stable.
    // This preserves the rule that normal mutations pass the full cold-open
    // integrity gate without allowing cold open to race the writer.
    await openLocalStore(rootPath);
    return await run({ database, recovery });
  } finally {
    database?.close();
    await lock.release();
  }
}

/**
 * Drain the durable revision outbox in order. A failed older revision remains
 * queued and prevents later revisions from overtaking it. Delivery is
 * intentionally at-least-once: a crash after the external hook succeeds but
 * before the SQLite acknowledgement may replay the same revision.
 */
async function drainRevisionNotifications(
  database: Database,
  hook: EffectiveRevisionHook | undefined,
): Promise<{ revision: number; error: unknown } | undefined> {
  for (;;) {
    const pending = readPendingRevisionNotifications(database)[0];
    if (pending === undefined) return undefined;
    if (hook === undefined) {
      return {
        revision: pending.revision,
        error: new Error("effective revision hook is not configured"),
      };
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- outbox delivery must remain revision-serial
      await hook(pending.revision, pending.delta);
      deletePendingRevisionNotification(database, pending.revision);
    } catch (error) {
      return { revision: pending.revision, error };
    }
  }
}

const REVISION_DELIVERY_LOCK_DIRECTORY = "revision-delivery";

/**
 * Drain after the commit lock has been released. A separate non-blocking
 * delivery lock preserves cross-process hook order without deadlocking a hook
 * that starts another LocalStore mutation. A nested delivery reports pending;
 * the outer drainer observes and delivers its newly-enqueued row next.
 */
export async function deliverRevisionNotifications(
  rootPath: string,
  hook: EffectiveRevisionHook | undefined,
  fallbackRevision: number,
): Promise<{ revision: number; error: unknown } | undefined> {
  const deliveryRoot = join(rootPath, REVISION_DELIVERY_LOCK_DIRECTORY);
  await mkdir(deliveryRoot, { recursive: true });
  let lock;
  try {
    lock = await acquireMutationLock(deliveryRoot, { waitMs: 0, pollIntervalMs: 1 });
  } catch (error) {
    if (error instanceof StoreBusyError) {
      let database: Database | undefined;
      try {
        database = await openStoreDatabase(rootPath);
        const oldest = readPendingRevisionNotifications(database)[0];
        return { revision: oldest?.revision ?? fallbackRevision, error };
      } catch {
        return { revision: fallbackRevision, error };
      } finally {
        database?.close();
      }
    }
    throw error;
  }

  let database: Database | undefined;
  try {
    database = await openStoreDatabase(rootPath);
    return await drainRevisionNotifications(database, hook);
  } catch (error) {
    return { revision: fallbackRevision, error };
  } finally {
    database?.close();
    await lock.release();
  }
}
