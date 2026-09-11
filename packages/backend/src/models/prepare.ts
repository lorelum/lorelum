import { open, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedEmbeddingConfig } from "../config/embedding";
import { downloadFile, DownloadError } from "../download/file";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL } from "../modules/embedding/model";
import type { ModelProgress } from "../modules/embedding/dto";
import { verifyResource } from "../runtime/embedding-resources";
import { assertPrivateFile, checkDirectory } from "../runtime/runtime-state";
import { withStartupLock } from "../runtime/startup-lock";

interface ModelArtifact {
  readonly bytes: number;
  readonly sha256: string;
}
/** Owns the fixed model cache; transport does not choose paths, trust or lifecycle state. */
export async function prepareModel(
  config: ResolvedEmbeddingConfig,
  signal: AbortSignal,
  progress: (value: ModelProgress) => void,
  dependencies: { artifact?: ModelArtifact; download?: typeof downloadFile } = {},
): Promise<string> {
  const artifact = dependencies.artifact ?? EMBEDDING_MODEL;
  const verify = async (path: string) => {
    progress({ phase: "verifying" });
    try {
      await verifyResource(path, artifact.bytes, artifact.sha256, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new EmbeddingError("embedding.resource-invalid");
    }
    signal.throwIfAborted();
    return path;
  };
  if (config.modelPath) return verify(config.modelPath);
  const directory = join(config.cacheDirectory, artifact.sha256);
  const destination = join(directory, "model.gguf");
  // Do not create a cache just to report a missing source or disabled download.
  if (await checkDirectory(directory)) {
    if (await assertPrivateFile(destination)) return verify(destination);
  }
  if (!config.download.enabled) throw new EmbeddingError("embedding.not-configured");
  if (!config.download.url) throw new EmbeddingError("embedding.download-unavailable");
  signal.throwIfAborted();
  // Reuse the existing crash-released SQLite writer lock; never create a PID lock protocol.
  return withStartupLock(directory, 0, async () => {
    signal.throwIfAborted();
    if (await assertPrivateFile(destination)) return verify(destination);
    const partial = `${destination}.part`;
    signal.throwIfAborted();
    if (!(await assertPrivateFile(partial))) {
      const file = await open(partial, "wx", 0o600);
      await file.close();
    }
    const size = (await stat(partial)).size;
    if (size > artifact.bytes) throw new EmbeddingError("embedding.resource-invalid");
    if (size < artifact.bytes) {
      try {
        await (dependencies.download ?? downloadFile)({
          ...config.download,
          url: config.download.url,
          destination: partial,
          bytes: artifact.bytes,
          signal,
          onProgress: (value) => progress({ phase: "downloading", ...value }),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof DownloadError) {
          const code =
            error.reason === "stalled"
              ? "embedding.download-stalled"
              : error.reason === "range-unsupported"
                ? "embedding.download-range-unsupported"
                : "embedding.download-failed";
          throw new EmbeddingError(code);
        }
        throw error;
      }
    }
    await verify(partial);
    await rename(partial, destination);
    return destination;
  }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "backend.deadline-exceeded")
      throw new EmbeddingError("embedding.busy");
    throw error;
  });
}
