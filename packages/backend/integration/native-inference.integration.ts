/* eslint-disable no-await-in-loop -- Each thread count owns one native process and sequential requests. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { llamaArguments } from "../src/runtime/llama-options";
import {
  developmentEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
} from "../src/runtime/native/embedding/catalog";
import { assertUnitVector, modelPathFromArgs } from "./support/native";

// Accept an unpacked release executable too: this check must exercise the bytes being shipped.
const model = modelPathFromArgs();
const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
assert(artifact, "Unsupported native target");
const executable = process.argv[3]
  ? resolve(process.argv[3])
  : join(developmentEmbeddingArtifactDirectory(artifact), artifact.manifest.executable);
const sha256 = createHash("sha256")
  .update(new Uint8Array(await Bun.file(executable).arrayBuffer()))
  .digest("hex");
const inputs = [
  ["hello"],
  ["保留已确认的决定并继续任务"],
  ["continue engineering with current decisions", "保留已确认的决定并继续任务"],
  ["engineering knowledge retrieval ".repeat(64), "工程知识检索与实现验证。".repeat(64)],
];

for (const threads of [2, 4, 8]) {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  assert(port, "Expected an ephemeral port");
  const secret = randomBytes(32).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = Bun.spawn(
    [executable, ...llamaArguments(model, port, "native-inference", { threads })],
    {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...(process.platform === "win32"
          ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
          : {}),
        LLAMA_API_KEY: secret,
        LLAMA_PARENT_LIVENESS_STDIN: "1",
      },
    },
  );
  const stderr = new Response(child.stderr).text();
  let failed = false;
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      assert.equal(child.exitCode, null, `Native exited before readiness: ${child.exitCode}`);
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch {
        // Connection refusal is expected until model loading opens the listener.
      }
      assert(Date.now() < deadline, "Native readiness timed out");
      await Bun.sleep(50);
    }
    let requests = 0;
    for (let repeat = 0; repeat < 5; repeat++) {
      for (const input of inputs) {
        const response = await fetch(`${baseUrl}/v1/embeddings`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input, encoding_format: "float" }),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.status !== 200) assert.fail(await response.text());
        const body = (await response.json()) as { data: { index: number; embedding: number[] }[] };
        assert.equal(body.data.length, input.length);
        for (const [index, item] of body.data.entries()) {
          assert.equal(item.index, index);
          assertUnitVector(item.embedding);
        }
        requests++;
      }
    }
    assert.equal(child.exitCode, null, "Native must remain alive after inference");
    console.log(
      JSON.stringify({ scenario: "native-inference", threads, requests, sha256, status: "passed" }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    if (failed) console.error(await stderr);
  }
}
