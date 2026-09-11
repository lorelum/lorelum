import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareModel } from "../src/models/prepare";
import { downloadFile } from "../src/download/file";
import { resolveEmbeddingConfig } from "../src/config/embedding";
import { DEFAULT_BACKEND_SETTINGS } from "../src/config/model";
import { createEmbeddingService } from "../src/modules/embedding/service";
import { createEmbeddingProcess } from "../src/runtime/embedding-process";
import { EMBEDDING_MODEL } from "../src/modules/embedding/model";
import { assertUnitVector, modelPathFromArgs } from "./support/native";
import { createInterruptedDownloadServer } from "./support/download-server";

const modelPath = modelPathFromArgs();
const root = await realpath(await mkdtemp(join(tmpdir(), "lore-download-acceptance-")));
try {
  const server = createInterruptedDownloadServer(modelPath);
  try {
    await verifyResumableModel(server);
  } finally {
    await server.stop();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

async function verifyResumableModel(server: ReturnType<typeof createInterruptedDownloadServer>) {
  const config = resolveEmbeddingConfig({ cacheDirectory: root });
  const service = createEmbeddingService({
    settings: DEFAULT_BACKEND_SETTINGS,
    prepareModel: (signal, progress) =>
      prepareModel(config, signal, progress, {
        download: (options) =>
          downloadFile({ ...options, url: server.url }, { protocols: "=http,https" }),
      }),
    createRuntime: (path) => createEmbeddingProcess({ modelPath: path }),
  });
  try {
    assert.equal(
      service.beginLoad().state,
      "loading",
      "load must return before the download completes",
    );
    await service.load();
    assert.equal(service.status().state, "ready", "Downloaded and verified model must load");
    assert.deepEqual(
      server.offsets,
      [0, server.interruptedBytes],
      "Retry must resume the retained 1 MiB",
    );
    const cachedModel = join(root, EMBEDDING_MODEL.sha256, "model.gguf");
    assert.equal((await stat(cachedModel)).size, EMBEDDING_MODEL.bytes, "Complete cache size");
    assertUnitVector((await service.embed("query", ["本地模型下载恢复验证"])).vectors[0]);

    await service.unload();
    const requests = server.offsets.length;
    await service.load();
    assert.equal(
      server.offsets.length,
      requests,
      "Verified cache must not access the download server",
    );
    console.log(
      JSON.stringify({
        scenario: "download-resume-and-cache",
        status: "passed",
        bytes: EMBEDDING_MODEL.bytes,
        requests,
        resumedFromBytes: server.offsets[1],
        cacheReused: true,
        nativeEncoded: true,
      }),
    );
  } finally {
    await service.unload();
  }
}
