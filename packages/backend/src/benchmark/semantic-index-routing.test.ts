import { expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contentSemanticIndexPaths,
  createContentAddressedSemanticServices,
  createEmbeddingProfile,
  createLocalStore,
  createSemanticIndexService,
  defaultQueryArtifactCacheRoot,
  indexCorpusDigest,
  SemanticIndexNotReadyError,
  type ContentAddressedCorpus,
  type EmbeddingPort,
  type StorageRoot,
} from "@lorelum/engine";

import { semanticIndexPaths } from "../../../engine/src/query/semantic/index/paths";
import { createPackCandidate } from "../../../engine/src/local-store/model/candidate";
import { EmbeddingError } from "../modules/embedding/errors";
import {
  BENCHMARK_CACHE_ROOT_ENV_VAR,
  BenchmarkCacheRootError,
  createBenchmarkSemanticTraceService,
  resolveBenchmarkCacheRoot,
} from "./semantic-index-routing";
import {
  executeSemanticRetrievalHarnessRequest,
  parseSemanticRetrievalHarnessRequest,
} from "./semantic-retrieval-protocol";

const encodingId = "a".repeat(64);
const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
const practiceIds = ["platform.core", "platform.domain", "platform.support"] as const;

/** Fully controlled embedding port: deterministic vectors, no model or native runtime. */
const embedding: EmbeddingPort = Object.freeze({
  maxBatchSize: 8,
  async embed(inputs: readonly string[]) {
    return { encodingId, vectors: inputs.map(() => [1, 0]) };
  },
});

/** Windows releases a closed SQLite handle asynchronously; retry the temp cleanup. */
async function removeRoot(rootPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- cleanup retries must back off serially
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      // eslint-disable-next-line no-await-in-loop -- cleanup retries must back off serially
      await Bun.sleep(50);
    }
  }
}

async function fixture(
  run: (roots: { readonly storeRoot: string; readonly cacheRoot: string }) => Promise<void>,
): Promise<void> {
  const storeRoot = await mkdtemp(join(tmpdir(), "lorelum-benchmark-store-"));
  const cacheRoot = await mkdtemp(join(tmpdir(), "lorelum-benchmark-cache-"));
  try {
    await run({ storeRoot, cacheRoot });
  } finally {
    await Promise.all([removeRoot(storeRoot), removeRoot(cacheRoot)]);
  }
}

/** Install one real test-owned Pack so the harness reads a canonical LocalStore. */
async function seedStore(storeRoot: string): Promise<void> {
  const store = createLocalStore();
  const candidate = createPackCandidate(
    {
      pack: { name: "platform", version: "1.0.0" },
      practices: practiceIds.map((id) => ({
        id,
        title: id,
        stage: "api",
        tech_stack: ["typescript"],
        applies_when: `when routing ${id}`,
        severity: "warn",
        body: `Guidance for ${id}.`,
      })),
      decisions: [],
    },
    Object.fromEntries(practiceIds.map((id) => [id, `practices/${id}.md`])),
  ).candidate;
  await store.install({ rootPath: storeRoot }, candidate);
}

async function corpusFor(storeRoot: string): Promise<ContentAddressedCorpus> {
  const snapshot = await createLocalStore().readEffectivePracticeSnapshot({ rootPath: storeRoot });
  return Object.freeze({
    practices: snapshot.practices,
    indexCorpusDigest: indexCorpusDigest(snapshot.practices),
  });
}

/** Build the semantic artifact exactly the way Store-only `lore index build` does. */
async function buildDerivedArtifact(corpus: ContentAddressedCorpus, cacheRoot: string) {
  const services = createContentAddressedSemanticServices(corpus, cacheRoot, profile, embedding);
  return services.index.build(services.root);
}

interface HarnessTraceQuery {
  query(
    root: StorageRoot,
    request: {
      readonly text: string;
      readonly candidateWidth: number;
      readonly resultLimit: number;
    },
  ): Promise<{ readonly candidateIds: readonly string[]; readonly finalIds: readonly string[] }>;
}

async function runHarnessRequest(
  query: HarnessTraceQuery,
  input: Readonly<Record<string, unknown>>,
  embeddingProfileId: string = profile.profileId,
) {
  const parsed = parseSemanticRetrievalHarnessRequest(JSON.stringify(input));
  if (parsed.status !== "valid") return parsed.response;
  return executeSemanticRetrievalHarnessRequest(parsed.request, {
    embeddingProfileId,
    query: (root, request) => query.query(root, request),
  });
}

test("reads the derived cache root from the benchmark environment and otherwise uses the default", () => {
  const configured = join(tmpdir(), "benchmark-owned-cache");
  let fallbacks = 0;
  const fallback = () => {
    fallbacks += 1;
    return join(tmpdir(), "benchmark-default-cache");
  };

  expect(resolveBenchmarkCacheRoot({ [BENCHMARK_CACHE_ROOT_ENV_VAR]: configured }, fallback)).toBe(
    configured,
  );
  expect(fallbacks).toBe(0);

  expect(resolveBenchmarkCacheRoot({}, fallback)).toBe(join(tmpdir(), "benchmark-default-cache"));
  expect(fallbacks).toBe(1);

  expect(resolveBenchmarkCacheRoot(process.env)).toBe(defaultQueryArtifactCacheRoot());
});

test("rejects a relative benchmark cache root instead of silently falling back", () => {
  let fallbacks = 0;
  const fallback = () => {
    fallbacks += 1;
    return join(tmpdir(), "benchmark-default-cache");
  };
  expect(() =>
    resolveBenchmarkCacheRoot({ [BENCHMARK_CACHE_ROOT_ENV_VAR]: "relative/cache" }, fallback),
  ).toThrow(BenchmarkCacheRootError);
  expect(fallbacks).toBe(0);
});

test("queries the content-addressed artifact from the cache root, not the Store root", () =>
  fixture(async ({ storeRoot, cacheRoot }) => {
    await seedStore(storeRoot);
    const corpus = await corpusFor(storeRoot);
    await buildDerivedArtifact(corpus, cacheRoot);
    await expect(
      access(contentSemanticIndexPaths(cacheRoot, corpus, profile.profileId).active),
    ).resolves.toBeNull();

    const trace = createBenchmarkSemanticTraceService({
      store: createLocalStore(),
      cacheRoot,
      profile,
      embedding,
    });
    const result = await trace.query(
      { rootPath: storeRoot },
      { text: "benchmark routing", candidateWidth: 3, resultLimit: 2 },
    );

    expect(result.candidateIds).toEqual([...practiceIds]);
    expect(result.finalIds).toEqual([...practiceIds.slice(0, 2)]);
    // The canonical Store root owns sources only; nothing was indexed beside them.
    await expect(access(join(storeRoot, "indexes"))).rejects.toThrow();
  }));

test("does not fall back to a Store-local index when the derived cache has no artifact", () =>
  fixture(async ({ storeRoot, cacheRoot }) => {
    await seedStore(storeRoot);
    const store = createLocalStore();
    await createSemanticIndexService({ store, profile, embedding }).build({ rootPath: storeRoot });
    // The legacy Store-local artifact really is there and really is compatible.
    await expect(
      access(semanticIndexPaths(storeRoot, profile.profileId).active),
    ).resolves.toBeNull();

    const trace = createBenchmarkSemanticTraceService({ store, cacheRoot, profile, embedding });
    const response = await runHarnessRequest(trace, {
      query: "benchmark routing",
      storeRoot,
      embeddingProfileId: profile.profileId,
      candidateWidth: 3,
      resultLimit: 2,
    });

    expect(response).toEqual({ status: "error", errorCode: "index_unavailable" });
    expect(Object.keys(response)).toEqual(["status", "errorCode"]);
  }));

test("returns one protocol v1 trace built from the benchmark cache artifact", () =>
  fixture(async ({ storeRoot, cacheRoot }) => {
    await seedStore(storeRoot);
    await buildDerivedArtifact(await corpusFor(storeRoot), cacheRoot);
    const trace = createBenchmarkSemanticTraceService({
      store: createLocalStore(),
      cacheRoot,
      profile,
      embedding,
    });

    const response = await runHarnessRequest(trace, {
      query: "benchmark routing",
      storeRoot,
      embeddingProfileId: profile.profileId,
      candidateWidth: 3,
      resultLimit: 1,
    });

    expect(response).toEqual({
      status: "ok",
      candidateIds: [...practiceIds],
      finalIds: [practiceIds[0]],
    });
    expect(Object.keys(response).sort()).toEqual(["candidateIds", "finalIds", "status"]);
  }));

test("keeps structured failures free of partial lists for runtime and Profile mismatches", () =>
  fixture(async ({ storeRoot, cacheRoot }) => {
    await seedStore(storeRoot);
    await buildDerivedArtifact(await corpusFor(storeRoot), cacheRoot);
    const failing: EmbeddingPort = Object.freeze({
      maxBatchSize: 1,
      async embed() {
        throw new EmbeddingError("embedding.not-loaded");
      },
    });

    const runtimeFailure = await runHarnessRequest(
      createBenchmarkSemanticTraceService({
        store: createLocalStore(),
        cacheRoot,
        profile,
        embedding: failing,
      }),
      {
        query: "benchmark routing",
        storeRoot,
        embeddingProfileId: profile.profileId,
        candidateWidth: 3,
        resultLimit: 2,
      },
    );
    expect(runtimeFailure).toEqual({ status: "error", errorCode: "runtime_unavailable" });

    const profileFailure = await runHarnessRequest(
      createBenchmarkSemanticTraceService({
        store: createLocalStore(),
        cacheRoot,
        profile,
        embedding,
      }),
      {
        query: "benchmark routing",
        storeRoot,
        embeddingProfileId: "b".repeat(64),
        candidateWidth: 3,
        resultLimit: 2,
      },
    );
    expect(profileFailure).toEqual({ status: "error", errorCode: "profile_mismatch" });

    for (const response of [runtimeFailure, profileFailure]) {
      expect(Object.keys(response)).toEqual(["status", "errorCode"]);
      expect(JSON.stringify(response)).not.toMatch(/candidateIds|finalIds/);
    }
  }));

test("rejects an artifact whose metadata belongs to another corpus", () =>
  fixture(async ({ storeRoot, cacheRoot }) => {
    await seedStore(storeRoot);
    const corpus = await corpusFor(storeRoot);
    const first = await corpusFor(storeRoot);
    await buildDerivedArtifact(first, cacheRoot);
    // A Store-local artifact is not a content-addressed artifact for this corpus.
    const store = createLocalStore();
    await createSemanticIndexService({ store, profile, embedding }).build({ rootPath: storeRoot });
    const localArtifact = semanticIndexPaths(storeRoot, profile.profileId).active;
    const contentAddressed = contentSemanticIndexPaths(cacheRoot, corpus, profile.profileId).active;
    await Bun.write(contentAddressed, await Bun.file(localArtifact).arrayBuffer());

    const trace = createBenchmarkSemanticTraceService({ store, cacheRoot, profile, embedding });
    const response = await runHarnessRequest(trace, {
      query: "benchmark routing",
      storeRoot,
      embeddingProfileId: profile.profileId,
      candidateWidth: 3,
      resultLimit: 2,
    });

    expect(response).toEqual({ status: "error", errorCode: "index_unavailable" });
  }));

test("fails as a structured index error when the artifact is missing", () =>
  fixture(async ({ storeRoot, cacheRoot }) => {
    await seedStore(storeRoot);
    const trace = createBenchmarkSemanticTraceService({
      store: createLocalStore(),
      cacheRoot,
      profile,
      embedding,
    });
    await expect(
      trace.query(
        { rootPath: storeRoot },
        { text: "benchmark routing", candidateWidth: 3, resultLimit: 2 },
      ),
    ).rejects.toBeInstanceOf(SemanticIndexNotReadyError);
  }));
