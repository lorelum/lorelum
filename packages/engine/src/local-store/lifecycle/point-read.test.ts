import { expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UnvalidatedPackInput } from "@lorelum/format";

import {
  createLocalStore,
  InvalidPracticeIdError,
  StoreRecoveryRequiredError,
  type StorageRoot,
} from "../index";
import { createPackCandidate, type PackCandidate } from "../model";
import {
  clearOperationJournal,
  createOperationJournalRecord,
  listOperationJournals,
  writeOperationJournal,
} from "../storage/journal/operation-journal";
import {
  createEmptyManifest,
  readManifest,
  writeManifest,
} from "../storage/manifest/manifest-store";
import { acquireMutationLock } from "../storage/mutation-lock";
import { openStoreDatabase } from "../storage/sqlite/database";
import { writeDerivedState } from "../storage/sqlite/state-writer";

async function removeStoreRoot(rootPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- cleanup retries must run sequentially
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      // eslint-disable-next-line no-await-in-loop -- retries must back off serially
      await Bun.sleep(50);
    }
  }
}

async function withRoot(run: (root: StorageRoot) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-point-read-"));
  try {
    await run({ rootPath });
  } finally {
    await removeStoreRoot(rootPath);
  }
}

function candidate(name: string, practices: Record<string, string>): PackCandidate {
  const input: UnvalidatedPackInput = {
    pack: { name, version: "1.0.0" },
    practices: Object.entries(practices).map(([id, body]) => ({
      id,
      title: id.split(".").at(-1) ?? id,
      stage: "api",
      tech_stack: ["typescript"],
      applies_when: "building an API",
      severity: "warn",
      body,
    })),
    decisions: [],
  };
  const paths = Object.fromEntries(
    Object.keys(practices).map((id) => [id, `practices/${id.replaceAll(".", "/")}.md`]),
  );
  return createPackCandidate(input, paths).candidate;
}

test("point read returns exactly the full snapshot Practice with deterministic source order", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const practiceId = "platform.api";
    // Intentionally install in reverse lexical order: SQL, rather than install
    // order, owns the public source ordering.
    await store.install(root, candidate("zebra", { [practiceId]: "Use APIs.\n" }));
    await store.install(root, candidate("alpha", { [practiceId]: "Use APIs.\n" }));

    const full = (await store.readEffectivePractices(root)).find(
      (practice) => practice.practiceId === practiceId,
    );
    const point = await store.getEffectivePractice(root, practiceId);

    expect(point).toEqual(full);
    expect(point?.sources.map((source) => source.packName)).toEqual(["alpha", "zebra"]);
  });
});

test("point read validates a malformed ID before it creates or opens the Store", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lorelum-point-read-invalid-id-"));
  const root = { rootPath: join(parent, "not-created") };
  try {
    await expect(
      createLocalStore().getEffectivePractice(root, "not-a-dotted-practice-id"),
    ).rejects.toBeInstanceOf(InvalidPracticeIdError);
    await expect(access(root.rootPath)).rejects.toThrow();
  } finally {
    await removeStoreRoot(parent);
  }
});

test("point read initializes a missing root and returns undefined for an absent valid ID", async () => {
  await withRoot(async (root) => {
    const result = await createLocalStore().getEffectivePractice(root, "platform.missing");
    expect(result).toBeUndefined();
    await expect(access(root.rootPath)).resolves.toBeNull();
  });
});

test("persisted empty manifest remains readable without a metadata row", async () => {
  await withRoot(async (root) => {
    await writeManifest(root.rootPath, createEmptyManifest());
    const store = createLocalStore();
    expect(await store.getEffectivePractice(root, "platform.missing")).toBeUndefined();
    expect(await store.readEffectivePractices(root)).toEqual([]);
  });
});

test.each([
  {
    name: "duplicate title column",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database.run("UPDATE effective_practices SET title = 'tampered'");
      });
    },
  },
  {
    name: "target revision",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database.run("UPDATE effective_practices SET effective_revision = 99");
      });
    },
  },
  {
    name: "missing sources",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database.run("DELETE FROM practice_sources");
      });
    },
  },
  {
    name: "source path",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database.run("UPDATE practice_sources SET source_path = '../outside.md'");
      });
    },
  },
  {
    name: "canonical content",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database
          .query("UPDATE effective_practices SET canonical_content = ? WHERE practice_id = ?")
          .run('{"id":"platform.api"}', "platform.api");
      });
    },
  },
  {
    name: "metadata",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database.query("UPDATE local_store_metadata SET effective_revision = 99").run();
      });
    },
  },
  {
    name: "source row",
    corrupt(rootPath: string) {
      return withDatabase(rootPath, (database) => {
        database
          .query("UPDATE practice_sources SET content_digest = ? WHERE practice_id = ?")
          .run("0".repeat(64), "platform.api");
      });
    },
  },
])("point read rejects damaged target $name", async ({ corrupt }) => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", { "platform.api": "Use APIs.\n" }));
    await corrupt(root.rootPath);

    await expect(store.getEffectivePractice(root, "platform.api")).rejects.toBeInstanceOf(
      StoreRecoveryRequiredError,
    );
  });
});

test("point read does not audit unrelated SQLite rows or Pack artifacts", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(
      root,
      candidate("platform", {
        "platform.api": "Use APIs.\n",
        "platform.unrelated": "Unrelated guidance.\n",
      }),
    );
    await withDatabase(root.rootPath, (database) => {
      database
        .query("UPDATE effective_practices SET canonical_content = ? WHERE practice_id = ?")
        .run('{"id":"platform.unrelated"}', "platform.unrelated");
    });

    const manifest = await readManifest(root.rootPath);
    const entry = manifest.packs[0]!;
    const artifactDirectory = join(
      root.rootPath,
      "packs",
      entry.storageKey,
      entry.artifactDigest,
      "practices/platform/unrelated.md",
    );
    await writeFile(artifactDirectory, "Tampered artifact.\n");

    await expect(store.getEffectivePractice(root, "platform.api")).resolves.toMatchObject({
      practiceId: "platform.api",
    });
    // Full cold open is still the integrity-auditing path and therefore sees
    // the unrelated SQLite damage.
    await expect(store.open(root)).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
  });
});

test("point read converges an interrupted manifest publication before returning the target", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", { "platform.api": "Use APIs.\n" }));
    const before = await readManifest(root.rootPath);
    const target = {
      ...before,
      generation: before.generation + 1,
      effectiveRevision: before.effectiveRevision + 1,
    };
    const journal = createOperationJournalRecord("reindex", before, target);
    await writeOperationJournal(root.rootPath, journal);
    await writeManifest(root.rootPath, target);

    await expect(store.getEffectivePractice(root, "platform.api")).resolves.toMatchObject({
      practiceId: "platform.api",
    });
    expect(await readManifest(root.rootPath)).toEqual(before);
    expect(await listOperationJournals(root.rootPath)).toEqual([]);
  });
});

test("point read waits for a live journal-owning writer rather than reading its half state", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", { "platform.api": "Use APIs.\n" }));
    const before = await readManifest(root.rootPath);
    const opened = await store.open(root);
    const target = {
      ...before,
      generation: before.generation + 1,
      effectiveRevision: before.effectiveRevision + 1,
    };
    const lock = await acquireMutationLock(root.rootPath);
    const journal = createOperationJournalRecord("reindex", before, target);
    await writeOperationJournal(root.rootPath, journal);
    await writeManifest(root.rootPath, target);

    const pendingRead = store.getEffectivePractice(root, "platform.api");
    await Bun.sleep(100);
    expect(await listOperationJournals(root.rootPath)).toEqual([journal.operationId]);

    await withDatabase(root.rootPath, (database) => {
      writeDerivedState(database, {
        generation: target.generation,
        effectiveRevision: target.effectiveRevision,
        activePacks: target.packs,
        effectivePractices: opened.effectivePractices,
      });
    });
    await clearOperationJournal(root.rootPath, journal.operationId);
    await lock.release();

    await expect(pendingRead).resolves.toMatchObject({ practiceId: "platform.api" });
  });
});

async function withDatabase(
  rootPath: string,
  action: (database: Awaited<ReturnType<typeof openStoreDatabase>>) => void,
): Promise<void> {
  const database = await openStoreDatabase(rootPath);
  try {
    action(database);
  } finally {
    database.close();
  }
}
