import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactPack, type PackInput } from "@lorelum/format";
import { createLocalStore, StoreRecoveryRequiredError, type StorageRoot } from "../local-store";
import { createPackCandidate } from "../local-store/model";
import { readManifest, writeManifest } from "../local-store/storage/manifest/manifest-store";
import {
  createOperationJournalRecord,
  listOperationJournals,
  writeOperationJournal,
} from "../local-store/storage/journal/operation-journal";
import { openStoreDatabase } from "../local-store/storage/sqlite/database";
import { createQueryService } from "./query-service";

async function withRoot(run: (root: StorageRoot) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-query-test-"));
  try {
    await run({ rootPath });
  } finally {
    await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function candidate(input: PackInput) {
  return createPackCandidate(
    input,
    Object.fromEntries(
      input.practices.map((practice) => [practice.id, `practices/${practice.id}.md`]),
    ),
  ).candidate;
}

test("query-to-get preserves IDs and digest on the public React fixture", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate(reactPack()));
    const query = createQueryService({ store });
    for (const [text, expected] of [
      ["axios", "react.api.layered-design"],
      ["Redux", "react.state.redux"],
      ["Route guard", "react.auth.guard"],
      ["localStorage", "react.api.layered-design"],
      ["DTO", "react.api.layered-design"],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- each case verifies one full query/get pair
      const result = await query.query(root, { text, limit: 1 });
      expect(result.results[0]?.practiceId).toBe(expected);
      // eslint-disable-next-line no-await-in-loop -- get uses the candidate from this query
      const full = await store.getEffectivePractice(root, expected);
      expect(result.results[0]?.contentDigest).toBe(full?.contentDigest);
    }
  });
});

test("new queries reflect install, upgrade and uninstall without an index migration", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const query = createQueryService({ store });
    const input = reactPack();
    input.practices[0]!.body = "Zebrafish guidance";
    await store.install(root, candidate(input));
    const first = await query.query(root, { text: "Zebrafish" });
    expect(first.results).toHaveLength(1);
    input.pack.version = "0.2.0";
    input.practices[0]!.body = "Narwhal guidance";
    await store.upgrade(root, candidate(input));
    expect((await query.query(root, { text: "Zebrafish" })).results).toEqual([]);
    const second = await query.query(root, { text: "Narwhal" });
    expect(second.results).toHaveLength(1);
    expect(second.results[0]?.contentDigest).not.toBe(first.results[0]?.contentDigest);
    const before = await readManifest(root.rootPath);
    const database = await openStoreDatabase(root.rootPath);
    const tables = () =>
      database.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    try {
      const beforeTables = tables();
      await query.query(root, { text: "Narwhal" });
      expect(tables()).toEqual(beforeTables);
      expect(await readManifest(root.rootPath)).toEqual(before);
    } finally {
      database.close();
    }
    await store.uninstall(root, input.pack.name);
    expect((await query.query(root, { text: "Narwhal" })).results).toEqual([]);
  });
});

test("query uses the full-read error contract without converging operation journals", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate(reactPack()));
    const before = await readManifest(root.rootPath);
    const target = {
      ...before,
      generation: before.generation + 1,
      effectiveRevision: before.effectiveRevision + 1,
    };
    const journal = createOperationJournalRecord("reindex", before, target);
    await writeOperationJournal(root.rootPath, journal);
    await writeManifest(root.rootPath, target);
    await expect(
      createQueryService({ store }).query(root, { text: "Redux" }),
    ).rejects.toBeInstanceOf(StoreRecoveryRequiredError);
    expect(await listOperationJournals(root.rootPath)).toEqual([journal.operationId]);
    expect(await readManifest(root.rootPath)).toEqual(target);
  });
});
