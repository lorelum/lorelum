/* eslint-disable no-await-in-loop -- Scenarios share one real native process. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createBackendApp } from "../src/app";
import { createBackendClient, type BackendClient } from "../src/client/client";
import { createBackendService } from "../src/modules/backend/service";
import { createContentAddressedSemanticRuntimeStub } from "../src/modules/query/content-addressed-semantic-runtime.test-helper";
import type { EmbeddingResult } from "../src/modules/embedding/model";
import { PROTOCOL_VERSION } from "../src/protocol/constants";
import {
  assertUnitVector,
  createNativeFixture,
  HARNESS_ENCODE_BUDGET_MS,
  modelPathFromArgs,
} from "./support/native";
import { readRssMiB, waitUntil } from "./support/process";
import { verifyReferences } from "./support/reference";

let beforeEncode:
  | ((inputs: readonly string[], signal: AbortSignal) => Promise<void> | void)
  | undefined;
const fixture = createNativeFixture(modelPathFromArgs(), {
  threads: 4,
  beforeEncode: (inputs, signal) => beforeEncode?.(inputs, signal),
});
const identity = {
  instanceId: "integration",
  buildIdentity: "integration",
  protocolVersion: PROTOCOL_VERSION,
};
const secret = "integration-only";
const app = createBackendApp({
  backend: createBackendService({
    identity,
    secret,
    modelState: () => fixture.service.status().state,
    onStop: () => fixture.service.unload().then(() => {}),
  }),
  embedding: fixture.service,
  port: 0,
  keywordQueryService: {
    async query() {
      return { mode: "keyword", results: [] };
    },
  },
  semanticRuntime: createContentAddressedSemanticRuntimeStub(),
});

// Declared before the scenario runs; a top-level const below the try block is in the
// temporal dead zone when sampleEncoding executes and throws on every run.
const sampleText = "semantic index integration sample";
try {
  app.listen({ hostname: "127.0.0.1", port: 0 });
  assert(app.server, "Integration HTTP server must be listening");
  const client = createBackendClient({
    identity,
    secret,
    buildIdentity: identity.buildIdentity,
    baseUrl: `http://127.0.0.1:${app.server.port}`,
    timeoutMs: HARNESS_ENCODE_BUDGET_MS,
  });
  assert.equal((await client.statusModel()).state, "unloaded");
  const started = performance.now();
  assert.equal((await client.loadModel()).state, "ready");
  const loadMs = performance.now() - started;
  const readyRssMiB = await readRssMiB(fixture.process);

  if (process.argv[3]) await verifyReferences(client, resolve(process.argv[3]));
  const samples = await sampleEncoding(client);
  const nativeBatch = await verifyNativeBatchIsolation(client);
  const aggregateCapacity = await verifyAggregateBatchCapacity(client);
  const statusWhileBusyMs = await verifyBusyAdmission(client);
  const workloadRssMiB = await readRssMiB(fixture.process);
  await verifyReloadCycles(client);
  console.log(
    JSON.stringify({
      scenario: "http-embedding",
      status: "passed",
      cycles: 3,
      observations: {
        loadMs,
        readyRssMiB,
        workloadRssMiB,
        ...samples,
        nativeBatch,
        aggregateCapacity,
        statusWhileBusyMs,
      },
    }),
  );
} finally {
  try {
    await fixture.service.unload();
  } finally {
    await app.stop(true);
  }
}

type Client = BackendClient;

/** Observations only; functional acceptance does not assert a machine-specific performance target. */
async function sampleEncoding(client: Client) {
  const times: number[] = [];
  const sampleCount = 20;
  for (let index = 0; index < sampleCount; index++) {
    const started = performance.now();
    const result = await client.embed("document", [sampleText]);
    times.push(performance.now() - started);
    assert.equal(result.vectors.length, 1);
    assertUnitVector(result.vectors[0]);
  }
  times.sort((a, b) => a - b);
  return {
    sampleCount,
    documentsPerSecond: (sampleCount * 1000) / times.reduce((a, b) => a + b, 0),
    p95Ms: times[Math.ceil(sampleCount * 0.95) - 1],
  };
}

/** A request can exceed the native aggregate token budget while each sequence still fits. */
async function verifyAggregateBatchCapacity(client: Client) {
  const text = "a ".repeat(1400);
  const individual = await client.embed("document", [text]);
  const result = await client.embed(
    "document",
    Array.from({ length: 8 }, () => text),
  );
  assert.equal(result.vectors.length, 8);
  const expected = individual.vectors[0];
  assertUnitVector(expected);
  for (const vector of result.vectors) {
    assertUnitVector(vector);
    assert(
      vectorCosine(vector, expected) > 0.9999,
      "Capacity scheduling must preserve the full sequence",
    );
  }
  return { inputs: result.vectors.length, charactersPerInput: text.length };
}

/**
 * Compare real native results, not a forwarding mock. Distinct singleton references
 * identify each sequence across lengths, positions, duplicate inputs, and neighbors.
 */
async function verifyNativeBatchIsolation(client: Client) {
  const texts = [
    "cache",
    "Use an exclusive writer lock while publishing a semantic index snapshot.",
    "中文检索：索引批处理应保持每一条输入的独立语义。",
    "function identity<T>(value: T): T { return value; }",
    "The model reuses its resident process; cancelled requests must release native resources.",
    "Database transactions preserve committed rows while concurrent readers use snapshots. ".repeat(
      12,
    ),
    "Why is the sky blue?",
    "A recipe combines flour, water, yeast, and salt before the dough is left to rise. ".repeat(4),
  ];
  const permutations = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [7, 6, 5, 4, 3, 2, 1, 0],
    [5, 0, 3, 7, 1, 6, 4, 2],
    [0, 5, 0, 7, 5, 2, 2, 1],
  ];
  const retrievalCases = [
    { query: "What ingredients are needed to make bread dough?", sequence: 7 },
    {
      query: "How do transactions let concurrent readers see committed database data?",
      sequence: 5,
    },
    {
      query: "Show a TypeScript generic function that returns its argument unchanged.",
      sequence: 3,
    },
    { query: "Explain the blue color of the daytime sky.", sequence: 6 },
  ];
  const semanticQueries = await client.embed(
    "query",
    retrievalCases.map((entry) => entry.query),
  );
  assert.equal(semanticQueries.vectors.length, retrievalCases.length);
  semanticQueries.vectors.forEach(assertUnitVector);
  let minCosine = 1;
  let maxComponentDelta = 0;
  let comparisons = 0;
  let nativeRequests = 0;
  let maxReferenceCosine = -1;
  let minAssociationMargin = Infinity;
  let semanticRetrievalChecks = 0;
  for (const kind of ["document", "query"] as const) {
    const individual: number[][] = [];
    for (const text of texts) {
      const result = await client.embed(kind, [text]);
      assert.equal(result.vectors.length, 1);
      assertUnitVector(result.vectors[0]);
      individual.push(result.vectors[0]);
    }
    for (const [left, vector] of individual.entries()) {
      for (const [right, other] of individual.entries()) {
        if (left === right) continue;
        const similarity = vectorCosine(vector, other);
        maxReferenceCosine = Math.max(maxReferenceCosine, similarity);
        assert(
          similarity < 0.95,
          `${kind} references ${left}/${right} are too similar to establish unambiguous sequence identity`,
        );
      }
    }
    for (const permutation of permutations) {
      const inputs = permutation.map((index) => {
        const text = texts[index];
        assert(text !== undefined, `Missing sequence ${index}`);
        return text;
      });
      const nativeInputs: (readonly string[])[] = [];
      beforeEncode = (batch, signal) => {
        assert(!signal.aborted, "Native batch must start with a live request signal");
        nativeInputs.push([...batch]);
      };
      let result: EmbeddingResult;
      try {
        result = await client.embed(kind, inputs);
      } finally {
        beforeEncode = undefined;
      }
      assert.deepEqual(
        nativeInputs,
        [inputs],
        "One HTTP batch must enter the real native runtime once with every input in order",
      );
      nativeRequests += nativeInputs.length;
      assert.equal(result.vectors.length, inputs.length);
      for (const [position, sequence] of permutation.entries()) {
        const actual = result.vectors[position];
        const expected = individual[sequence];
        assertUnitVector(actual);
        assertUnitVector(expected);
        let dot = 0;
        let actualSquared = 0;
        let expectedSquared = 0;
        let componentDelta = 0;
        for (const [component, value] of actual.entries()) {
          const reference: number | undefined = expected[component];
          assert(reference !== undefined);
          dot += value * reference;
          actualSquared += value * value;
          expectedSquared += reference * reference;
          componentDelta = Math.max(componentDelta, Math.abs(value - reference));
        }
        const cosine = dot / Math.sqrt(actualSquared * expectedSquared);
        const label = `${kind} sequence=${sequence} position=${position} order=${permutation.join(",")}`;
        let nearestSequence = -1;
        let nearestCosine = -Infinity;
        let nearestOtherCosine = -Infinity;
        for (const [candidate, vector] of individual.entries()) {
          const similarity = vectorCosine(actual, vector);
          if (similarity > nearestCosine) {
            nearestCosine = similarity;
            nearestSequence = candidate;
          }
          if (candidate !== sequence) nearestOtherCosine = Math.max(nearestOtherCosine, similarity);
        }
        assert.equal(nearestSequence, sequence, `${label}: vector belongs to a different input`);
        const associationMargin = cosine - nearestOtherCosine;
        assert(associationMargin > 0, `${label}: sequence association is ambiguous`);
        minAssociationMargin = Math.min(minAssociationMargin, associationMargin);
        // REPACK kernels can change floating-point results by batch shape. Preserve
        // sequence identity and semantic ranking; report, rather than gate, numeric drift.
        minCosine = Math.min(minCosine, cosine);
        maxComponentDelta = Math.max(maxComponentDelta, componentDelta);
        comparisons += 1;
      }
      if (kind === "document") {
        for (const [queryIndex, retrieval] of retrievalCases.entries()) {
          if (!permutation.includes(retrieval.sequence)) continue;
          const query = semanticQueries.vectors[queryIndex];
          assertUnitVector(query);
          let bestSequence = -1;
          let bestScore = -Infinity;
          for (const [position, vector] of result.vectors.entries()) {
            const score = vectorCosine(query, vector);
            if (score > bestScore) {
              bestScore = score;
              const sequence = permutation[position];
              assert(sequence !== undefined);
              bestSequence = sequence;
            }
          }
          assert.equal(
            bestSequence,
            retrieval.sequence,
            `Semantic retrieval must find the labeled document: ${retrieval.query}`,
          );
          semanticRetrievalChecks += 1;
        }
      }
    }
  }
  return {
    nativeRequests,
    comparisons,
    semanticRetrievalChecks,
    maxReferenceCosine,
    minAssociationMargin,
    minCosine,
    maxComponentDelta,
  };
}

/** Cosine similarity remains valid even within the accepted unit-normalization tolerance. */
function vectorCosine(left: readonly number[], right: readonly number[]) {
  assert.equal(left.length, right.length);
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (const [index, value] of left.entries()) {
    const other = right[index];
    assert(other !== undefined);
    dot += value * other;
    leftSquared += value * value;
    rightSquared += other * other;
  }
  assert(leftSquared > 0 && rightSquared > 0);
  return dot / Math.sqrt(leftSquared * rightSquared);
}

async function verifyBusyAdmission(client: Client) {
  let entered = false;
  let release = () => {};
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  beforeEncode = async () => {
    entered = true;
    await gate;
  };
  const batch = client.embed("document", Array<string>(8).fill("busy"));
  // Observe settlement immediately so a request failure cannot become an unhandled rejection.
  const settled = batch.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  let statusMs = 0;
  try {
    await waitUntil("batch to enter the encoding slot", async () => entered);
    const started = performance.now();
    assert.equal(
      (await client.status()).state,
      "ready",
      "Control API must respond while encoding is occupied",
    );
    statusMs = performance.now() - started;
    await assert.rejects(client.embed("query", ["busy"]), { code: "embedding.busy" });
  } finally {
    beforeEncode = undefined;
    release();
    await settled;
  }
  const outcome = await settled;
  if ("error" in outcome) throw outcome.error;
  assert.equal(outcome.result.vectors.length, 8, "Released batch must complete");
  return statusMs;
}

async function verifyReloadCycles(client: Client) {
  assert.equal((await client.unloadModel()).state, "unloaded");
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.equal((await client.loadModel()).state, "ready");
    const result = await client.embed("query", ["原文保持不变。", "code example"]);
    assert.equal(result.vectors.length, 2);
    result.vectors.forEach(assertUnitVector);
    assert.equal((await client.unloadModel()).state, "unloaded");
  }
}
