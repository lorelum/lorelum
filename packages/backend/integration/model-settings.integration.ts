/* eslint-disable no-await-in-loop -- Token-limit cases use one real native process at a time. */
import assert from "node:assert/strict";
import { embeddingEncodingId } from "../src/modules/embedding/model";
import { assertUnitVector, createNativeFixture, modelPathFromArgs } from "./support/native";
import { readRssMiB } from "./support/process";

const cases = [
  { maxTokens: 512, threads: 4 },
  { maxTokens: 1024, threads: 2 },
  { maxTokens: 2048, threads: 4 },
] as const;
const modelPath = modelPathFromArgs();
for (const settings of cases) await verifySettings(settings);

async function verifySettings(settings: (typeof cases)[number]) {
  const { maxTokens, threads } = settings;
  const fixture = createNativeFixture(modelPath, settings);
  const { service } = fixture;
  try {
    await service.load();
    assert.equal(service.status().maxTokens, maxTokens, "Configured token limit");
    assert.equal(service.status().threads, threads, "Configured thread count");
    assert.equal(service.status().encodingId, embeddingEncodingId(maxTokens), "Encoding identity");

    // The fixed tokenizer adds three tokens to this repeated-text fixture.
    const boundaryText = "hello ".repeat(maxTokens - 3);
    assert.equal(
      (await fixture.runtime.tokenize(boundaryText, AbortSignal.timeout(1000))).length,
      maxTokens,
    );
    assertUnitVector((await service.embed("document", [boundaryText])).vectors[0]);
    await assert.rejects(service.embed("document", ["hello ".repeat(maxTokens - 2)]), {
      code: "embedding.input-too-long",
    });
    assert.equal(service.status().state, "ready", "Rejected input must not unload the model");

    // Observations only: no performance pass/fail threshold, and thread counts differ by case.
    const times: number[] = [];
    for (let sample = 0; sample < 5; sample++) {
      const started = performance.now();
      const result = await service.embed("document", [boundaryText]);
      times.push(performance.now() - started);
      assertUnitVector(result.vectors[0]);
    }
    console.log(
      JSON.stringify({
        scenario: "token-settings",
        status: "passed",
        maxTokens,
        threads,
        observations: {
          sampleCount: times.length,
          meanMs: times.reduce((a, b) => a + b) / times.length,
          sampledRssMiB: await readRssMiB(fixture.process),
        },
      }),
    );
  } finally {
    await service.unload();
  }
}
