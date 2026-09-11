/* eslint-disable no-await-in-loop -- Explicit acceptance polls a single shared loading operation. */
import { strict as assert } from "node:assert";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareModel } from "../src/models/prepare";
import { downloadFile } from "../src/download/file";
import { resolveEmbeddingConfig } from "../src/config/embedding";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import { createEmbeddingService } from "../src/modules/embedding/service";
import { createEmbeddingProcess } from "../src/runtime/embedding-process";
import { EMBEDDING_MODEL } from "../src/modules/embedding/model";

if (!process.argv[2]) throw new Error("Provide the fixed Q4_0 model path");
const model = Bun.file(resolve(process.argv[2]));
const root = await realpath(await mkdtemp(join(tmpdir(), "lore-download-acceptance-")));
const ranges: number[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const offset = Number(request.headers.get("range")?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
    ranges.push(offset);
    const headers = {
      "content-length": String(model.size - offset),
      "accept-ranges": "bytes",
      ...(offset ? { "content-range": `bytes ${offset}-${model.size - 1}/${model.size}` } : {}),
    };
    if (ranges.length === 1) {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new Uint8Array(await model.slice(0, 1024 * 1024).arrayBuffer()));
            await Bun.sleep(50);
            controller.error(new Error("intentional interrupted transfer"));
          },
        }),
        { headers },
      );
    }
    return new Response(model.slice(offset), { status: offset ? 206 : 200, headers });
  },
  error() {
    return new Response(null, { status: 500 });
  },
});
const config = resolveEmbeddingConfig({
  cacheDirectory: root,
  download: { url: "https://fixture.invalid/fixed-model" },
});
const service = createEmbeddingService({
  settings: DEFAULT_BACKEND_SETTINGS,
  prepareModel: (signal, progress) =>
    prepareModel(config, signal, progress, {
      download: (options) =>
        downloadFile(
          { ...options, url: `http://127.0.0.1:${server.port}/model` },
          { protocols: "=http,https" },
        ),
    }),
  createRuntime: (modelPath) => createEmbeddingProcess({ modelPath }),
});
try {
  const accepted = service.beginLoad();
  assert.equal(accepted.state, "loading");
  await service.load();
  assert.equal(service.status().state, "ready");
  assert(ranges.length >= 2 && ranges[1]! > 0, "transfer must resume actual partial bytes");
  assert.equal(
    (await stat(join(root, EMBEDDING_MODEL.sha256, "model.gguf"))).size,
    EMBEDDING_MODEL.bytes,
  );
  assert.equal((await service.embed("query", ["本地模型下载恢复验证"])).vectors[0]!.length, 384);
  await service.unload();
  const requests = ranges.length;
  await service.load();
  assert.equal(ranges.length, requests, "verified cache must not access download server");
  console.log(
    JSON.stringify({
      status: "passed",
      bytes: EMBEDDING_MODEL.bytes,
      requests,
      resumedFromBytes: ranges[1],
      cacheReused: true,
      nativeEncoded: true,
    }),
  );
} finally {
  await service.unload();
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
