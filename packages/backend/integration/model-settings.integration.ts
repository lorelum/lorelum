/* eslint-disable no-await-in-loop -- Explicit real-model acceptance uses one native process at a time. */
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { createEmbeddingProcess } from "../src/runtime/embedding-process";
import { createEmbeddingService } from "../src/modules/embedding/service";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import type { EmbeddingRuntime } from "../src/modules/embedding/model";
import { embeddingEncodingId } from "../src/modules/embedding/model";
import type { ProcessIdentity } from "../src/runtime/process-identity";

if (!process.argv[2]) throw new Error("Provide the fixed Q4_0 model path");
const modelPath = resolve(process.argv[2]);
for (const maxTokens of [512, 1024, 2048] as const) {
  let runtime: EmbeddingRuntime;
  let processIdentity: ProcessIdentity | undefined;
  const threads = maxTokens === 1024 ? 2 : 4;
  const service = createEmbeddingService({
    settings: { ...DEFAULT_BACKEND_SETTINGS, startupTimeoutMs: 15_000 },
    threads,
    maxTokens,
    createRuntime: () =>
      (runtime = createEmbeddingProcess({ modelPath, threads, maxTokens }, async (identity) => {
        processIdentity = identity;
      })),
  });
  try {
    await service.load();
    assert.equal(service.status().maxTokens, maxTokens);
    assert.equal(service.status().threads, threads);
    assert.equal(service.status().encodingId, embeddingEncodingId(maxTokens));
    const text = "hello ".repeat(maxTokens - 3);
    assert.equal((await runtime!.tokenize(text, AbortSignal.timeout(1000))).length, maxTokens);
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      const started = performance.now();
      const result = await service.embed("document", [text]);
      assert.equal(result.vectors[0]!.length, 384);
      const norm = Math.sqrt(result.vectors[0]!.reduce((sum, x) => sum + x * x, 0));
      assert(Math.abs(norm - 1) < 0.001);
      if (i > 0) times.push(performance.now() - started);
    }
    await assert.rejects(service.embed("document", ["hello ".repeat(maxTokens - 2)]), {
      code: "embedding.input-too-long",
    });
    assert.equal(service.status().state, "ready");
    const ps = Bun.spawn(["/bin/ps", "-o", "rss=", "-p", String(processIdentity!.pid)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const rssMiB = Number((await new Response(ps.stdout).text()).trim()) / 1024;
    assert.equal(await ps.exited, 0);
    console.log(
      JSON.stringify({
        status: "passed",
        maxTokens,
        threads,
        sampleCount: times.length,
        meanMs: times.reduce((a, b) => a + b) / times.length,
        sampledRssMiB: rssMiB,
      }),
    );
  } finally {
    await service.unload();
  }
}
