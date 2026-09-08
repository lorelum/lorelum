import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  StoreBusyError,
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StoreSnapshotIdentity,
} from "../local-store";
import { canonicalizePractice } from "../local-store/model";
import { InvalidQueryRequestError, KeywordIndexError } from "./errors";
import { createQueryService } from "./query-service";
import type { QueryDependencies } from "./types";

function entry(id = "example.react", title = "React authentication"): EffectivePractice {
  const canonical = canonicalizePractice({
    id,
    title,
    stage: "api",
    tech_stack: ["react"],
    applies_when: "React authentication",
    body: "Complete private-to-get guidance",
    severity: "warn",
  });
  return { practiceId: id, ...canonical, sources: [] };
}

async function withRoot(run: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-query-service-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function identity(rootPath: string, revision = 1): StoreSnapshotIdentity {
  return Object.freeze({
    rootBinding: `test:${rootPath}`,
    generation: revision,
    effectiveRevision: revision,
    manifestDigest: `manifest:${revision}`,
  });
}

function snapshotStore(
  practices: readonly EffectivePractice[],
  options: { readonly readIdentity?: () => Promise<StoreSnapshotIdentity> } = {},
): QueryDependencies["store"] {
  return {
    async readSnapshotIdentity(root) {
      return options.readIdentity?.() ?? identity(root.rootPath);
    },
    async readEffectivePracticeSnapshot(root) {
      return { identity: identity(root.rootPath), practices };
    },
    async readEffectivePracticeChanges() {
      return undefined;
    },
    async readEffectivePracticesAtSnapshot(root, expected, ids) {
      const current = identity(root.rootPath);
      if (
        current.rootBinding !== expected.rootBinding ||
        current.effectiveRevision !== expected.effectiveRevision
      ) {
        throw new StoreSnapshotChangedError();
      }
      const wanted = new Set(ids);
      return practices.filter((practice) => wanted.has(practice.practiceId));
    },
  };
}

test("one query builds a persistent index and assembles summaries from one canonical snapshot", async () => {
  await withRoot(async (rootPath) => {
    const practice = entry();
    const service = createQueryService({ store: snapshotStore([practice]) });
    const result = await service.query({ rootPath }, { text: "React" });
    expect(result).toEqual({
      mode: "keyword",
      results: [
        {
          practiceId: practice.practiceId,
          title: practice.practice.title,
          stage: "api",
          techStack: ["react"],
          appliesWhen: "React authentication",
          severity: "warn",
          contentDigest: practice.contentDigest,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Complete private-to-get guidance");
  });
});

test("invalid requests never read a Store", async () => {
  let reads = 0;
  const service = createQueryService({
    store: {
      async readSnapshotIdentity() {
        reads++;
        return identity("unused");
      },
      async readEffectivePracticeSnapshot() {
        return { identity: identity("unused"), practices: [] };
      },
      async readEffectivePracticeChanges() {
        return undefined;
      },
      async readEffectivePracticesAtSnapshot() {
        return [];
      },
    },
  });
  await expect(service.query({ rootPath: "/unused" }, { text: " " })).rejects.toBeInstanceOf(
    InvalidQueryRequestError,
  );
  await expect(
    service.query({ rootPath: "/unused" }, { text: "React", limit: 100 }),
  ).rejects.toBeInstanceOf(InvalidQueryRequestError);
  expect(reads).toBe(0);
});

test("default top-k and equal-score ordering are deterministic", async () => {
  await withRoot(async (rootPath) => {
    const practices = [6, 5, 4, 3, 2, 1].map((id) => entry(`example.item${id}`, "same focus"));
    const service = createQueryService({ store: snapshotStore(practices) });
    const result = await service.query({ rootPath }, { text: "focus" });
    expect(result.results.map((hit) => hit.practiceId)).toEqual([
      "example.item1",
      "example.item2",
      "example.item3",
      "example.item4",
      "example.item5",
    ]);
  });
});

test("empty Stores, unmatched text, and tokenless text return successful empty results", async () => {
  await withRoot(async (rootPath) => {
    for (const practices of [[], [entry()]]) {
      const service = createQueryService({ store: snapshotStore(practices) });
      for (const text of ["zzznomatch", "!!!"]) {
        // eslint-disable-next-line no-await-in-loop -- each request has its own index lifecycle
        expect(await service.query({ rootPath }, { text })).toEqual({
          mode: "keyword",
          results: [],
        });
      }
    }
  });
});

test("a Store error propagates before an index is opened", async () => {
  const error = new StoreBusyError("test busy");
  const service = createQueryService({
    store: {
      async readSnapshotIdentity() {
        throw error;
      },
      async readEffectivePracticeSnapshot() {
        throw error;
      },
      async readEffectivePracticeChanges() {
        throw error;
      },
      async readEffectivePracticesAtSnapshot() {
        throw error;
      },
    },
  });
  await expect(service.query({ rootPath: "/unused" }, { text: "React" })).rejects.toBe(error);
});

test("a changing Store retries a bounded number of times", async () => {
  await withRoot(async (rootPath) => {
    const practice = entry();
    let reads = 0;
    const service = createQueryService({
      store: {
        ...snapshotStore([practice]),
        async readEffectivePracticesAtSnapshot() {
          reads++;
          throw new StoreSnapshotChangedError();
        },
      },
    });
    await service.query({ rootPath }, { text: "React" });
    await expect(service.query({ rootPath }, { text: "React" })).rejects.toBeInstanceOf(
      StoreSnapshotChangedError,
    );
    expect(reads).toBe(3);
  });
});

test("a malformed canonical result is never converted into a partial success", async () => {
  await withRoot(async (rootPath) => {
    const practice = entry();
    const invalid = { ...practice, practice: { ...practice.practice, severity: undefined } };
    const service = createQueryService({ store: snapshotStore([invalid]) });
    await expect(service.query({ rootPath }, { text: "React" })).rejects.toBeInstanceOf(
      KeywordIndexError,
    );
  });
});
