/* eslint-disable no-await-in-loop -- Explicit integration checks run sequentially against one native slot. */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import frozenRetrieval from "../../../docs/research/onnx-validation/quantization-fixture.json";
import type { ProcessIdentity } from "../src/runtime/process-identity";
import type { EmbeddingRuntime } from "../src/modules/embedding/model";
import { resolve, join } from "node:path";
import { createBackendApp } from "../src/app";
import { createBackendClient } from "../src/client/client";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import { createBackendService } from "../src/modules/backend/service";
import { createEmbeddingService } from "../src/modules/embedding/service";
import { createEmbeddingProcess } from "../src/runtime/embedding-process";
import { PROTOCOL_VERSION } from "../src/protocol/constants";

const modelPath = process.argv[2];
if (!modelPath) throw new Error("Usage: embedding.integration.ts <fixed-Q4_0-model-path>");
const settings = { ...DEFAULT_BACKEND_SETTINGS, startupTimeoutMs: 15_000 };
let runtime: EmbeddingRuntime;
let nativeProcess: ProcessIdentity | undefined;
const embedding = createEmbeddingService({
  settings,
  createRuntime: () =>
    (runtime = createEmbeddingProcess({ modelPath: resolve(modelPath) }, async (identity) => {
      nativeProcess = identity;
    })),
});
const identity = {
  instanceId: "integration",
  buildIdentity: "integration",
  protocolVersion: PROTOCOL_VERSION,
};
const backend = createBackendService({
  identity,
  secret: "integration-only",
  modelState: () => embedding.status().state,
  onStop: async () => {
    await embedding.unload();
  },
});
const app = createBackendApp({
  backend,
  embedding,
  port: 0,
  queryService: {
    async query() {
      return { mode: "keyword", results: [] };
    },
  },
});
app.listen({ hostname: "127.0.0.1", port: 0 });
const client = createBackendClient({
  identity,
  secret: "integration-only",
  buildIdentity: identity.buildIdentity,
  baseUrl: `http://127.0.0.1:${app.server!.port}`,
});
const times: number[] = [];
try {
  assert.equal((await client.statusModel()).state, "unloaded");
  const loadingAt = performance.now();
  assert.equal((await client.loadModel()).state, "ready");
  const loadMs = performance.now() - loadingAt;
  const readyRssMiB = await nativeRss();
  let referenceChecks = 0;
  let minCosine = 1;
  const measured = new Map<string, number[]>();
  if (process.argv[3]) {
    const referenceRoot = resolve(process.argv[3]);
    const baseline = JSON.parse(
      await readFile(join(referenceRoot, "q4-reference.json"), "utf8"),
    ) as { vectors: { id: string; vector: number[] }[] };
    const expected = new Map(baseline.vectors.map((row) => [row.id, row.vector]));
    for (const entry of [...frozenRetrieval.documents, ...frozenRetrieval.queries]) {
      const vector = (await client.embed("document", [entry.text])).vectors[0]!;
      measured.set(entry.id, vector);
      const original = expected.get(entry.id)!;
      assert.equal(original.length, 384);
      const dot = vector.reduce((sum, value, index) => sum + value * original[index]!, 0);
      const cosine =
        dot /
        Math.sqrt(
          vector.reduce((sum, value) => sum + value * value, 0) *
            original.reduce((sum, value) => sum + value * value, 0),
        );
      minCosine = Math.min(minCosine, cosine);

      referenceChecks++;
    }
    const retrieval = (vectors: Map<string, number[]>) =>
      frozenRetrieval.queries.map((query) => {
        const q = vectors.get(query.id)!;
        return frozenRetrieval.documents
          .map((doc) => ({
            id: doc.id,
            score: q.reduce((sum, value, index) => sum + value * vectors.get(doc.id)![index]!, 0),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((row) => row.id);
      });
    const previousRanks = retrieval(expected);
    const currentRanks = retrieval(measured);
    const metrics = (ranks: string[][]) => {
      let hits = 0;
      let ndcg = 0;
      for (const [index, query] of frozenRetrieval.queries.entries()) {
        const rank = ranks[index]!;
        if (query.relevantIds.includes(rank[0]!)) hits++;
        const dcg = rank.reduce(
          (sum, id, position) =>
            sum + (query.relevantIds.includes(id) ? 1 / Math.log2(position + 2) : 0),
          0,
        );
        const ideal = query.relevantIds
          .slice(0, 5)
          .reduce((sum, _, position) => sum + 1 / Math.log2(position + 2), 0);
        ndcg += dcg / ideal;
      }
      return { hits, ndcg5: ndcg / ranks.length };
    };
    const originalMetrics = metrics(previousRanks);
    const currentMetrics = metrics(currentRanks);
    console.log(
      JSON.stringify({
        reference: originalMetrics,
        current: currentMetrics,
        minCosine,
        changedTop1: currentRanks.filter((rank, index) => rank[0] !== previousRanks[index]![0])
          .length,
        changedTop5: currentRanks.filter(
          (rank, index) => JSON.stringify(rank) !== JSON.stringify(previousRanks[index]),
        ).length,
      }),
    );
    // Portable CPU kernels differ from the old runner-native build; compare both
    // numerical proximity and frozen retrieval behavior, not bitwise float identity.
    assert(minCosine > 0.999, "Portable build exceeds the declared numerical drift limit");
    assert(currentMetrics.hits >= originalMetrics.hits, "Frozen top-1 retrieval regressed");
    assert(currentMetrics.ndcg5 + 1e-12 >= originalMetrics.ndcg5, "Frozen nDCG@5 regressed");
    const cases = JSON.parse(await readFile(join(referenceRoot, "fixtures.json"), "utf8")) as {
      cases: { name: string; texts: string[] }[];
    };
    const fp32 = JSON.parse(await readFile(join(referenceRoot, "fp32-reference.json"), "utf8")) as {
      cases: { name: string; input_ids: number[][]; attention_mask: number[][] }[];
    };
    for (const fixture of cases.cases) {
      const reference = fp32.cases.find((entry) => entry.name === fixture.name)!;
      for (const [index, text] of fixture.texts.entries()) {
        const tokens = reference.input_ids[index]!.filter(
          (_, at) => reference.attention_mask[index]![at],
        );
        if (tokens.length <= 512)
          assert.deepEqual(await runtime!.tokenize(text, AbortSignal.timeout(1000)), tokens);
      }
    }
  }
  const input = "hello ".repeat(509);
  await client.embed("document", [input]);
  for (let index = 0; index < 20; index++) {
    const start = performance.now();
    const result = await client.embed("document", [input]);
    assert.equal(result.vectors.length, 1);
    times.push(performance.now() - start);
  }
  await assert.rejects(client.embed("document", ["hello ".repeat(510)]), {
    code: "embedding.input-too-long",
  });
  assert.equal((await client.statusModel()).state, "ready");
  const batch = client.embed("document", Array<string>(8).fill(input));
  await Bun.sleep(20);
  const statusAt = performance.now();
  assert.equal((await client.status()).state, "ready");
  const statusMs = performance.now() - statusAt;
  await assert.rejects(client.embed("query", ["busy"]), { code: "embedding.busy" });
  assert.equal((await batch).vectors.length, 8);
  const workloadRssMiB = await nativeRss();
  assert.equal((await client.unloadModel()).state, "unloaded");
  for (let index = 0; index < 2; index++) {
    await client.loadModel();
    await client.embed("query", ["原文保持不变。", "code example"]);
    await client.unloadModel();
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      status: "passed",
      referenceChecks,
      minCosine,
      loadMs,
      readyRssMiB,
      workloadRssMiB,
      documentsPerSecond: 20_000 / times.reduce((a, b) => a + b, 0),
      p95Ms: times[18],
      statusDuringBatchMs: statusMs,
      cycles: 3,
    }),
  );
} finally {
  await embedding.unload();
  await app.stop(true);
}

async function nativeRss(): Promise<number> {
  assert(nativeProcess, "Native process identity is missing");
  const ps = Bun.spawn(["/bin/ps", "-o", "rss=", "-p", String(nativeProcess.pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const rss = Number((await new Response(ps.stdout).text()).trim());
  assert.equal(await ps.exited, 0);
  assert(Number.isFinite(rss) && rss > 0);
  return rss / 1024;
}
