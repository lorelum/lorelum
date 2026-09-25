import { createEmbeddingProfile, createLocalStore } from "@lorelum/engine";
import { loadBackendConfig, resolveEmbeddingConfig } from "../config";
import { createEmbeddingService } from "../modules/embedding/service";
import { createQueryEmbeddingAdapter } from "../modules/index/embedding-adapter";
import { prepareModel } from "../models/prepare";
import { createEmbeddingProcess } from "../runtime/embedding-process";
import {
  createBenchmarkSemanticTraceService,
  resolveBenchmarkCacheRoot,
} from "./semantic-index-routing";
import {
  executeSemanticRetrievalHarnessRequest,
  parseSemanticRetrievalHarnessRequest,
  serializeSemanticRetrievalHarnessResponse,
  type SemanticRetrievalHarnessResponse,
} from "./semantic-retrieval-protocol";

const MAX_REQUEST_BYTES = 32_768;

class BenchmarkInputTooLargeError extends Error {}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const value = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) throw new BenchmarkInputTooLargeError();
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function run(): Promise<void> {
  let response: SemanticRetrievalHarnessResponse = {
    status: "error",
    errorCode: "runtime_unavailable",
  };
  let embedding: ReturnType<typeof createEmbeddingService> | undefined;
  try {
    const input = await readStandardInput();
    const parsed = parseSemanticRetrievalHarnessRequest(input);
    if (parsed.status === "invalid") {
      response = parsed.response;
    } else {
      // Resolve the derived cache before touching the model: a misconfigured
      // harness environment must not pay for model preparation first.
      const cacheRoot = resolveBenchmarkCacheRoot();
      const config = await loadBackendConfig();
      const resolvedEmbedding = resolveEmbeddingConfig(config.embedding);
      const benchmarkEmbedding = Object.freeze({
        ...resolvedEmbedding,
        download: Object.freeze({ ...resolvedEmbedding.download, enabled: false }),
      });
      embedding = createEmbeddingService({
        settings: config.settings,
        threads: resolvedEmbedding.threads,
        prepareModel: (signal, progress) => prepareModel(benchmarkEmbedding, signal, progress),
        createRuntime: (modelPath) =>
          createEmbeddingProcess({ modelPath, threads: resolvedEmbedding.threads }),
      });
      const model = embedding.status();
      const profile = createEmbeddingProfile({
        encodingId: model.encodingId,
        dimensions: model.dimensions,
      });
      if (parsed.request.embeddingProfileId !== profile.profileId) {
        response = { status: "error", errorCode: "profile_mismatch" };
      } else {
        await embedding.load();
        const query = createBenchmarkSemanticTraceService({
          store: createLocalStore(),
          cacheRoot,
          profile,
          embedding: createQueryEmbeddingAdapter(embedding),
        });
        response = await executeSemanticRetrievalHarnessRequest(parsed.request, {
          embeddingProfileId: profile.profileId,
          query: (root, request) => query.query(root, request),
        });
      }
    }
  } catch (error) {
    response = {
      status: "error",
      errorCode:
        error instanceof BenchmarkInputTooLargeError ? "invalid_request" : "runtime_unavailable",
    };
  } finally {
    if (embedding !== undefined) {
      try {
        await embedding.unload();
      } catch {
        // A cleanup failure invalidates the run; never emit a successful partial trace.
        response = { status: "error", errorCode: "runtime_unavailable" };
      }
    }
  }
  process.stdout.write(serializeSemanticRetrievalHarnessResponse(response));
  if (response.status === "error") process.exitCode = 1;
}

if (import.meta.main) void run();
