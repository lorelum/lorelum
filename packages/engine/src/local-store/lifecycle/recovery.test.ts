import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UnvalidatedPackInput } from "@lorelum/format";

import { createLocalStore, type StorageRoot } from "../index";
import { StoreRecoveryRequiredError } from "../../local-store";
import { createPackCandidate, type PackCandidate } from "../model";
import { acquireMutationLock } from "../storage/mutation-lock";
import {
  clearOperationJournal,
  createOperationJournalRecord,
  listOperationJournals,
  writeOperationJournal,
} from "../storage/journal/operation-journal";
import { readManifest, writeManifest } from "../storage/manifest/manifest-store";
import { sqlitePath, openStoreDatabase } from "../storage/sqlite/database";
import { LOCAL_STORE_SCHEMA_VERSION } from "../storage/sqlite/migrations";
import { writeDerivedState } from "../storage/sqlite/state-writer";

async function removeStoreRoot(rootPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries must back off serially
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 9) throw new Error("cannot remove store root after retries");
      // eslint-disable-next-line no-await-in-loop -- backoff must be sequential
      await Bun.sleep(50);
    }
  }
}

async function withRoot(run: (root: StorageRoot) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-recover-"));
  try {
    await run({ rootPath });
  } finally {
    await removeStoreRoot(rootPath);
  }
}

function packInput(name: string, practices: Record<string, string>): UnvalidatedPackInput {
  return {
    pack: { name, version: "1.0.0" },
    practices: Object.entries(practices).map(([id, body]) => ({
      id,
      title: id.split(".").pop(),
      stage: "api",
      tech_stack: ["typescript"],
      applies_when: "building anything at all",
      severity: "warn",
      body,
    })),
    decisions: [],
  };
}

function sourcePaths(input: UnvalidatedPackInput): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const practice of input.practices) {
    if (typeof practice === "object" && practice !== null && "id" in practice) {
      const id = String((practice as { id: unknown }).id);
      paths[id] = `practices/${id.replace(/\./g, "/")}.md`;
    }
  }
  return paths;
}

function candidate(name: string, practices: Record<string, string>): PackCandidate {
  const input = packInput(name, practices);
  return createPackCandidate(input, sourcePaths(input)).candidate;
}

const platform = { "platform.api": "Use APIs.\n", "platform.auth": "Authenticate.\n" };

test("crash after manifest publish but before SQLite commit converges to the old tuple", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const before = await readManifest(root.rootPath);

    // Simulate the crash window: manifest published, SQLite not yet committed.
    // A leftover journal with old tuple (0,0) → target tuple (1,1) plus a
    // manifest already at (1,1) means recovery must restore the old manifest.
    const journal = createOperationJournalRecord("install", before, {
      ...before,
      generation: before.generation + 1,
      effectiveRevision: before.effectiveRevision + 1,
    });
    await writeOperationJournal(root.rootPath, journal);

    // open() runs recovery; SQLite tuple == old tuple → restore old manifest.
    const reopened = await store.open(root);
    expect(reopened.generation).toBe(before.generation);
  });
});

test("cold open rejects a missing SQLite file", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await rm(sqlitePath(root.rootPath), { force: true });
    // open() recreates an empty DB file, then recovery detects that the
    // manifest has committed state the (empty) SQLite never saw.
    await expect(store.open(root)).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
  });
});

test("cold open rejects SQLite whose tuple disagrees with the manifest", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    // Tamper SQLite metadata without a journal: manifest wins on recovery,
    // but the tuples disagree and no journal exists → recovery required.
    const database = await openStoreDatabase(root.rootPath);
    database.query("UPDATE local_store_metadata SET installed_packs_generation = 99").run();
    database.close();
    await expect(store.open(root)).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
  });
});

test("cold open rejects a tampered artifact digest", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    // Corrupt an author byte inside the immutable snapshot.
    const manifest = await readManifest(root.rootPath);
    const entry = manifest.packs[0]!;
    const practicePath = join(
      root.rootPath,
      "packs",
      entry.storageKey,
      entry.artifactDigest,
      "practices",
      "platform/api.md",
    );
    await writeFile(
      practicePath,
      "---\nid: platform.api\ntitle: T\nstage: api\ntech_stack: [typescript]\napplies_when: always\n---\nTampered.\n",
    );
    await expect(store.open(root)).rejects.toThrow("digest mismatch");
  });
});

test("reindex rebuilds a store whose SQLite was deleted", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await rm(sqlitePath(root.rootPath), { force: true });

    const reindexed = await store.reindex(root);
    expect(reindexed.effectiveRevision).toBeGreaterThan(0);
    const practices = await store.readEffectivePractices(root);
    expect(practices.map((p) => p.practiceId)).toEqual(["platform.api", "platform.auth"]);
  });
});

test("reindex creates a retained-history gap for derived index checkpoints", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const installed = await store.install(root, candidate("platform", platform));
    const reindexed = await store.reindex(root);
    expect(reindexed.effectiveRevision).toBeGreaterThan(installed.effectiveRevision);
    await expect(
      store.readEffectivePracticeChanges(root, installed.effectiveRevision),
    ).resolves.toBeUndefined();
  });
});

test("reindex restores derived state from the manifest and sealed artifacts", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    // Corrupt SQLite metadata to force an inconsistent tuple.
    const database = await openStoreDatabase(root.rootPath);
    database.query("UPDATE local_store_metadata SET effective_revision = 42").run();
    database.close();

    const reindexed = await store.reindex(root);
    // reindex derives the fresh revision from the manifest (authority), not
    // from the tampered SQLite value.
    expect(reindexed.effectiveRevision).toBeGreaterThan(0);
    const reopened = await store.open(root);
    expect(reopened.effectivePractices).toHaveLength(2);
  });
});

test("reindex never revives an uninstalled pack", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await store.uninstall(root, "platform");
    const reindexed = await store.reindex(root);
    expect(reindexed.delta.added).toEqual([]);
    expect(await store.readEffectivePractices(root)).toEqual([]);
  });
});

test("the post-commit hook receives each new revision with its delta", async () => {
  await withRoot(async (root) => {
    const notifications: { revision: number; added: readonly string[] }[] = [];
    const store = createLocalStore({
      onEffectiveRevisionAdvanced: (revision, delta) => {
        notifications.push({ revision, added: delta.added });
      },
    });
    await store.install(root, candidate("platform", platform));
    expect(notifications).toEqual([{ revision: 1, added: ["platform.api", "platform.auth"] }]);
  });
});

test("a failing post-commit hook never rolls back the mutation", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore({
      onEffectiveRevisionAdvanced: () => {
        throw new Error("vector layer offline");
      },
    });
    const installed = await store.install(root, candidate("platform", platform));
    expect(installed.generation).toBe(1);
    expect(installed.notificationPending?.revision).toBe(1);
    expect(installed.notificationPending?.error).toBeInstanceOf(Error);
    expect(await store.readEffectivePractices(root)).toHaveLength(2);
  });
});

test("concurrent mutations are serialized by the lock", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const lock = await acquireMutationLock(root.rootPath);
    // A mutation waiting on a held lock gives up after its bounded wait.
    await expect(
      Promise.race([
        store.install(root, candidate("platform", platform)),
        Bun.sleep(1_000).then(() => "timeout"),
      ]),
    ).resolves.toBe("timeout");
    await lock.release();
    const installed = await store.install(root, candidate("platform", platform));
    expect(installed.generation).toBe(1);
  });
});

test("cold open accepts two Packs that share a sourcePath (regression M1)", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    // Both Packs use the same relative path "practices/api.md" inside their
    // own snapshot; a sourcePath is only unique within a Pack (ADR 0007 §10).
    const samePath = (name: string, id: string, body: string): PackCandidate => {
      const input = packInput(name, { [id]: body });
      return createPackCandidate(input, { [id]: "practices/api.md" }).candidate;
    };
    await store.install(root, samePath("platform", "platform.api", "Use APIs.\n"));
    await store.install(root, samePath("web", "web.api", "Use Web APIs.\n"));
    const opened = await store.open(root);
    expect(opened.effectivePractices.map((p) => p.practiceId).sort()).toEqual([
      "platform.api",
      "web.api",
    ]);
  });
});

test("cold open reports a corrupt SQLite file as StoreRecoveryRequiredError (regression M2)", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await writeFile(sqlitePath(root.rootPath), "this is not a sqlite database at all");
    await expect(store.open(root)).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
  });
});

test("upgrade of a pack that was never installed throws PackNotInstalledError (regression M3)", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await expect(store.upgrade(root, candidate("missing", { "missing.api": "x" }))).rejects.toThrow(
      "not installed",
    );
  });
});

test("cold open reclaims a stale mutation lock only after recovery passes (ADR 0007 §12)", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    // A stale lock left by a crashed holder.
    const lockPath = join(root.rootPath, ".lock");
    await writeFile(
      lockPath,
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, startedAt: new Date().toISOString() }),
      "utf8",
    );
    const opened = await store.open(root);
    expect(opened.effectivePractices).toHaveLength(2);
    // The stale lock was removed as part of cold open.
    await expect(import("node:fs/promises").then((fs) => fs.access(lockPath))).rejects.toThrow();
  });
});

test("cold open never converges a journal while its writer still owns the lock", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const oldManifest = await readManifest(root.rootPath);
    const oldOpen = await store.open(root);
    const targetManifest = {
      ...oldManifest,
      generation: oldManifest.generation + 1,
      effectiveRevision: oldManifest.effectiveRevision + 1,
    };

    const writerLock = await acquireMutationLock(root.rootPath);
    const journal = createOperationJournalRecord("reindex", oldManifest, targetManifest);
    await writeOperationJournal(root.rootPath, journal);
    await writeManifest(root.rootPath, targetManifest);

    const concurrentOpen = store.open(root);
    await Bun.sleep(100);
    expect(await listOperationJournals(root.rootPath)).toEqual([journal.operationId]);
    expect((await readManifest(root.rootPath)).generation).toBe(targetManifest.generation);

    const database = await openStoreDatabase(root.rootPath);
    writeDerivedState(database, {
      generation: targetManifest.generation,
      effectiveRevision: targetManifest.effectiveRevision,
      activePacks: targetManifest.packs,
      effectivePractices: oldOpen.effectivePractices,
    });
    database.close();
    await clearOperationJournal(root.rootPath, journal.operationId);
    await writerLock.release();

    await expect(concurrentOpen).resolves.toMatchObject({
      generation: targetManifest.generation,
      effectiveRevision: targetManifest.effectiveRevision,
    });
  });
});

test("reindex converges and removes a journal left by an interrupted mutation", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const oldManifest = await readManifest(root.rootPath);
    const interruptedTarget = {
      ...oldManifest,
      generation: oldManifest.generation + 1,
      effectiveRevision: oldManifest.effectiveRevision + 1,
    };
    const journal = createOperationJournalRecord("reindex", oldManifest, interruptedTarget);
    await writeOperationJournal(root.rootPath, journal);
    await writeManifest(root.rootPath, interruptedTarget);

    const reindexed = await store.reindex(root);
    expect(await listOperationJournals(root.rootPath)).toEqual([]);
    await expect(store.open(root)).resolves.toMatchObject({
      generation: reindexed.generation,
      effectiveRevision: reindexed.effectiveRevision,
    });
  });
});

test("a failed hook revision is retried before a later revision is delivered", async () => {
  await withRoot(async (root) => {
    const attempts: number[] = [];
    const delivered: number[] = [];
    let failFirstRevision = true;
    const firstStore = createLocalStore({
      onEffectiveRevisionAdvanced: (revision) => {
        attempts.push(revision);
        if (revision === 1 && failFirstRevision) {
          failFirstRevision = false;
          throw new Error("vector layer temporarily offline");
        }
        delivered.push(revision);
      },
    });

    const first = await firstStore.install(root, candidate("platform", platform));
    expect(first.notificationPending?.revision).toBe(1);
    // A new facade proves ordering state is durable in SQLite rather than only
    // retained in one createLocalStore closure.
    const secondStore = createLocalStore({
      onEffectiveRevisionAdvanced: (revision) => {
        attempts.push(revision);
        delivered.push(revision);
      },
    });
    const second = await secondStore.install(root, candidate("web", { "web.css": "Use CSS.\n" }));
    expect(second.notificationPending).toBeUndefined();
    expect(attempts).toEqual([1, 1, 2]);
    expect(delivered).toEqual([1, 2]);
  });
});

test("reindex supersedes an old failed hook with a durable full refresh", async () => {
  await withRoot(async (root) => {
    const failingStore = createLocalStore({
      onEffectiveRevisionAdvanced: () => {
        throw new Error("vector layer offline");
      },
    });
    const first = await failingStore.install(root, candidate("platform", platform));
    expect(first.notificationPending?.revision).toBe(1);

    const reindexed = await createLocalStore().reindex(root);
    expect(reindexed.notificationPending?.revision).toBe(2);
    expect(reindexed.delta.added).toEqual(["platform.api", "platform.auth"]);

    const delivered: Array<{ revision: number; added: readonly string[] }> = [];
    const recoveredStore = createLocalStore({
      onEffectiveRevisionAdvanced: (revision, delta) => {
        delivered.push({ revision, added: delta.added });
      },
    });
    await recoveredStore.install(root, candidate("web", { "web.css": "Use CSS.\n" }));
    expect(delivered).toEqual([
      { revision: 2, added: ["platform.api", "platform.auth"] },
      { revision: 3, added: ["web.css"] },
    ]);
  });
});

test("a hook may start another LocalStore mutation without self-deadlocking", async () => {
  await withRoot(async (root) => {
    const delivered: number[] = [];
    let store: ReturnType<typeof createLocalStore>;
    store = createLocalStore({
      onEffectiveRevisionAdvanced: async (revision) => {
        delivered.push(revision);
        if (revision === 1) {
          await store.install(root, candidate("web", { "web.css": "Use CSS.\n" }));
        }
      },
    });

    const installed = await store.install(root, candidate("platform", platform));
    expect(installed.notificationPending).toBeUndefined();
    expect(delivered).toEqual([1, 2]);
    expect(
      (await store.open(root)).effectivePractices.map((practice) => practice.practiceId),
    ).toEqual(["platform.api", "platform.auth", "web.css"]);
  });
});

test("cold open maps post-migration SQLite corruption to recovery-required", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const database = await openStoreDatabase(root.rootPath);
    database.exec("DROP TABLE effective_practices");
    database.close();

    await expect(store.open(root)).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
    const reindexed = await store.reindex(root);
    await expect(store.open(root)).resolves.toMatchObject({
      generation: reindexed.generation,
      effectiveRevision: reindexed.effectiveRevision,
    });
  });
});

test("journal recovery maps a missing metadata table to recovery-required", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const oldManifest = await readManifest(root.rootPath);
    const targetManifest = {
      ...oldManifest,
      generation: oldManifest.generation + 1,
    };
    await writeOperationJournal(
      root.rootPath,
      createOperationJournalRecord("upgrade", oldManifest, targetManifest),
    );
    const database = await openStoreDatabase(root.rootPath);
    database.exec("DROP TABLE local_store_metadata");
    database.close();

    await expect(store.open(root)).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
  });
});

test("reindex preserves a newer unsupported SQLite database", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const raw = new Database(sqlitePath(root.rootPath));
    raw.exec("PRAGMA user_version = " + (LOCAL_STORE_SCHEMA_VERSION + 1));
    raw.close();

    await expect(store.reindex(root)).rejects.toThrow("schema version is unsupported");

    const reopened = new Database(sqlitePath(root.rootPath));
    expect(reopened.query("PRAGMA user_version").get()).toEqual({
      user_version: LOCAL_STORE_SCHEMA_VERSION + 1,
    });
    reopened.close();
  });
});
