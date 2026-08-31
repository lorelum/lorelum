import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UnvalidatedPackInput } from "@lorelum/format";

import {
  createLocalStore,
  defaultStorageRoot,
  StoreCounterExhaustedError,
  type StorageRoot,
} from "../index";
import { createPackCandidate, type PackCandidate } from "../model";
import { artifactPath, calculateArtifactDigest } from "../storage/artifacts/artifact-store";
import { listOperationJournals } from "../storage/journal/operation-journal";
import { readManifest, writeManifest } from "../storage/manifest/manifest-store";
import { openStoreDatabase } from "../storage/sqlite/database";

/**
 * bun:sqlite releases its Windows file handle asynchronously after close(),
 * so a directory containing store.sqlite may briefly report EBUSY. Retry the
 * cleanup — the production code never deletes a store root it just closed.
 */
async function removeStoreRoot(rootPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries must back off serially
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      // eslint-disable-next-line no-await-in-loop -- backoff must be sequential
      await Bun.sleep(50);
    }
  }
}

async function withRoot(run: (root: StorageRoot) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-store-"));
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
const platformV2 = { "platform.api": "Use APIs with retries.\n" };
const web = { "platform.api": "Use APIs.\n", "web.css": "Use CSS.\n" };

test("default storage root resolves under the home directory", () => {
  const root = defaultStorageRoot();
  expect(root.rootPath).toEndWith(".lorelum");
});

test("fresh store open + install + reopen round-trips state", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const opened = await store.open(root);
    expect(opened.generation).toBe(0);
    expect(opened.effectivePractices).toEqual([]);

    const installed = await store.install(root, candidate("platform", platform));
    expect(installed.generation).toBe(1);
    expect(installed.effectiveRevision).toBe(1);
    expect(installed.delta.added).toEqual(["platform.api", "platform.auth"]);
    expect(installed.cleanupPending).toBe(false);

    const reopened = await store.open(root);
    expect(reopened.generation).toBe(1);
    expect(reopened.effectivePractices.map((p) => p.practiceId)).toEqual([
      "platform.api",
      "platform.auth",
    ]);
    expect(await store.readEffectivePractices(root)).toHaveLength(2);
  });
});

test("first install creates a missing storage root before acquiring its lock", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lorelum-store-parent-"));
  const root = { rootPath: join(parent, "missing-store") };
  try {
    const installed = await createLocalStore().install(root, candidate("platform", platform));
    expect(installed.generation).toBe(1);
    expect(await readManifest(root.rootPath)).toMatchObject({ generation: 1 });
  } finally {
    await removeStoreRoot(parent);
  }
});

test("install is idempotent for the same artifact digest", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const again = await store.install(root, candidate("platform", platform));
    expect(again.idempotent).toBe(true);
    expect(again.generation).toBe(1); // no state change
    expect(again.effectiveRevision).toBe(1);
  });
});

test("install with a different digest requires upgrade", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await expect(store.install(root, candidate("platform", platformV2))).rejects.toThrow(
      "use upgrade",
    );
  });
});

test("upgrade replaces sources and removes old ones", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const first = await store.install(root, candidate("platform", platform));
    // platformV2 drops platform.auth and changes platform.api.
    const upgraded = await store.upgrade(root, candidate("platform", platformV2));
    expect(upgraded.delta.changed).toEqual(["platform.api"]);
    expect(upgraded.delta.invalidated).toEqual(["platform.auth"]);
    expect(upgraded.generation).toBe(first.generation + 1);
    expect(upgraded.effectiveRevision).toBe(first.effectiveRevision + 1);

    const practices = await store.readEffectivePractices(root);
    expect(practices.map((p) => p.practiceId)).toEqual(["platform.api"]);
    expect(practices[0]?.practice.body).toBe("Use APIs with retries.\n");
  });
});

test("upgrade conflicting with another active pack's practice is rejected", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    // web provides platform.api with identical content → mergeable.
    await store.install(root, candidate("web", web));
    // platformV2 changes platform.api; web still provides the old content.
    await expect(store.upgrade(root, candidate("platform", platformV2))).rejects.toThrow(
      "conflicts with active pack",
    );
  });
});

test("same practice id + different digest is rejected on install", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const conflicting = candidate("other", { "platform.api": "Different content.\n" });
    await expect(store.install(root, conflicting)).rejects.toThrow("conflicts with active pack");
  });
});

test("a source-only addition does not advance effectiveRevision (定稿 §9 #6)", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const first = await store.install(root, candidate("platform", platform));
    // web re-provides platform.api with byte-identical content and nothing
    // else: only the source set changes, the Effective Practice set does not.
    const merged = await store.install(root, candidate("web", { "platform.api": "Use APIs.\n" }));
    expect(merged.delta).toEqual({
      added: [],
      changed: [],
      invalidated: [],
    });
    expect(merged.effectiveRevision).toBe(first.effectiveRevision);
    expect(merged.generation).toBe(first.generation + 1); // manifest still changes

    const practices = await store.readEffectivePractices(root);
    const api = practices.find((p) => p.practiceId === "platform.api");
    expect(api?.sources.map((s) => s.packName).sort()).toEqual(["platform", "web"]);
  });
});

test("uninstall keeps a practice still provided by another pack", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await store.install(root, candidate("web", web));
    const removed = await store.uninstall(root, "platform");
    expect(removed.delta.invalidated).toEqual(["platform.auth"]);
    expect(removed.delta.added).toEqual([]);

    const practices = await store.readEffectivePractices(root);
    expect(practices.map((p) => p.practiceId)).toEqual(["platform.api", "web.css"]);
    expect(practices[0]?.sources.map((s) => s.packName)).toEqual(["web"]);
  });
});

test("uninstall of the last source deletes the Effective Practice", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const removed = await store.uninstall(root, "platform");
    expect(removed.delta.invalidated).toEqual(["platform.api", "platform.auth"]);
    expect(await store.readEffectivePractices(root)).toEqual([]);
  });
});

test("uninstall of a missing pack throws PackNotInstalledError", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    await expect(store.uninstall(root, "missing")).rejects.toThrow("not installed");
  });
});

test("format validation failure leaves no state behind", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const input = packInput("bad", { "bad.id": "x" });
    (input.practices[0] as { id: string }).id = "no-dots";
    await expect(
      Promise.resolve().then(() => createPackCandidate(input, sourcePaths(input))),
    ).rejects.toThrow("format validation");
    const opened = await store.open(root);
    expect(opened.effectivePractices).toEqual([]);
  });
});

test("install seals decisions into the snapshot and reindex preserves them (N2)", async () => {
  await withRoot(async (root) => {
    const input = packInput("platform", platform);
    input.decisions = [
      {
        id: "state.client-vs-server",
        question: "How much client state?",
        branches: [
          {
            when: "heavy client state",
            recommend: ["platform.api"],
            reason: "Redux scales",
          },
        ],
      },
    ];
    const cand = createPackCandidate(input, sourcePaths(input)).candidate;
    expect(cand.decisions).toHaveLength(1);

    const store = createLocalStore();
    await store.install(root, cand);

    // The rebuilt snapshot carries decisions.yaml and the sealed projection
    // records them, so a later reindex re-derives the same decision graph.
    const manifest = await readManifest(root.rootPath);
    const entry = manifest.packs[0]!;
    const artifactDir = artifactPath(root.rootPath, entry.storageKey, entry.artifactDigest);
    expect(await readFile(join(artifactDir, "decisions.yaml"), "utf8")).toContain(
      "state.client-vs-server",
    );

    const reindexed = await store.reindex(root);
    expect(reindexed.effectiveRevision).toBeGreaterThan(0);
    const reopened = await store.open(root);
    expect(reopened.effectivePractices).toHaveLength(2);

    const projection = JSON.parse(
      await readFile(join(artifactDir, ".lorelum", "local-store-projection.json"), "utf8"),
    ) as { decisions: unknown[] };
    expect(projection.decisions).toHaveLength(1);
    expect(projection.decisions[0]).toMatchObject({ id: "state.client-vs-server" });
  });
});

test("install replaces a corrupt artifact only after uninstall made it unreferenced", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    const cand = candidate("platform", platform);
    await store.install(root, cand);
    const entry = (await readManifest(root.rootPath)).packs[0]!;
    await store.uninstall(root, "platform");

    const target = artifactPath(root.rootPath, entry.storageKey, entry.artifactDigest);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "corrupt.txt"), "not the sealed snapshot", "utf8");

    await expect(store.install(root, cand)).resolves.toMatchObject({ idempotent: false });
    expect(await calculateArtifactDigest(target)).toBe(entry.artifactDigest);
  });
});

test("counter exhaustion rejects before writing a journal or changing state", async () => {
  await withRoot(async (root) => {
    const store = createLocalStore();
    await store.install(root, candidate("platform", platform));
    const manifest = await readManifest(root.rootPath);
    await writeManifest(root.rootPath, {
      ...manifest,
      generation: Number.MAX_SAFE_INTEGER,
    });
    const database = await openStoreDatabase(root.rootPath);
    database
      .query("UPDATE local_store_metadata SET installed_packs_generation = ?")
      .run(Number.MAX_SAFE_INTEGER);
    database.close();

    await expect(
      store.install(root, candidate("web", { "web.css": "Use CSS.\n" })),
    ).rejects.toBeInstanceOf(StoreCounterExhaustedError);
    expect((await readManifest(root.rootPath)).generation).toBe(Number.MAX_SAFE_INTEGER);
    expect(await listOperationJournals(root.rootPath)).toEqual([]);
  });
});
