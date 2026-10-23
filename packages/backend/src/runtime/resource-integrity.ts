/* eslint-disable no-await-in-loop -- Digest reads must be bounded and ordered. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { noopEmitter, type LogEmitter } from "@lorelum/log";
import { EmbeddingError, type ResourceFailure } from "../modules/embedding/errors";

const HASH_CHUNK_BYTES = 256 * 1024;

type ResourceIdentity = Pick<ResourceFailure, "kind" | "file">;

/** Verify ordinary readable model files, or the required native executable, during preparation. */
export async function verifyResource(
  path: string,
  bytes: number,
  digest: string,
  signal: AbortSignal,
  resource: ResourceIdentity,
  diagnostics: LogEmitter = noopEmitter,
): Promise<void> {
  const invalid = (check: ResourceFailure["check"], expected?: string, actual?: string) => {
    const failure = {
      ...resource,
      check,
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    };
    diagnostics.emit({
      level: "debug",
      component: "backend",
      event: "backend.resource.failed",
      path,
      resource: failure,
    });
    return new EmbeddingError(
      resource.kind === "native"
        ? "embedding.native-resource-invalid"
        : "embedding.resource-invalid",
      undefined,
      failure,
    );
  };
  signal.throwIfAborted();
  diagnostics.emit({
    level: "debug",
    component: "backend",
    event: "backend.resource.verifying",
    path,
    resource,
    expectedBytes: bytes,
    expectedSha256: digest,
  });
  const file = await open(
    path,
    constants.O_RDONLY | (resource.kind === "native" ? constants.O_NOFOLLOW : 0),
  ).catch((error: unknown) => {
    if (signal.aborted) throw error;
    throw invalid(
      error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing" : "invalid",
    );
  });
  try {
    const info = await file.stat();
    if (!info.isFile()) throw invalid("invalid");
    if (info.size !== bytes) throw invalid("size-mismatch", String(bytes), String(info.size));
    if (
      resource.kind === "native" &&
      (process.platform === "win32" ? !path.endsWith(".exe") : (info.mode & 0o111) === 0)
    )
      throw invalid("invalid");
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > bytes) throw invalid("size-mismatch", String(bytes), String(size));
      hash.update(chunk.subarray(0, bytesRead));
    }
    if (size !== bytes) throw invalid("size-mismatch", String(bytes), String(size));
    const actualDigest = hash.digest("hex");
    if (actualDigest !== digest) throw invalid("sha256-mismatch", digest, actualDigest);
    signal.throwIfAborted();
    diagnostics.emit({
      level: "debug",
      component: "backend",
      event: "backend.resource.verified",
      path,
      resource,
      bytes: size,
      sha256: actualDigest,
    });
  } catch (error) {
    if (signal.aborted || error instanceof EmbeddingError) throw error;
    throw invalid("invalid");
  } finally {
    await file.close();
  }
}
