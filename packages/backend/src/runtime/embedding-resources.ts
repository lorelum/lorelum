import { isDeepStrictEqual } from "node:util";
import { isCompiledEntrypoint } from "./build-identity";
/* eslint-disable no-await-in-loop -- Digest reads must be bounded and ordered. */
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import expectedMac from "../../../../native/embedding/artifacts/darwin-arm64.json";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL } from "../modules/embedding/model";

const MAX_MANIFEST_BYTES = 16_384;
const HASH_CHUNK_BYTES = 256 * 1024;

export interface EmbeddingResources {
  readonly executable: string;
  readonly buildIdentity: string;
  assertUnchanged(): Promise<void>;
}
/** Pinned installation assets only. Config cannot select a native executable or manifest. */
export async function resolveEmbeddingResources(
  modelPath: string,
  signal: AbortSignal,
): Promise<EmbeddingResources> {
  try {
    if (process.platform !== expectedMac.platform || process.arch !== expectedMac.arch)
      throw new EmbeddingError("embedding.resource-invalid");
    const expected = expectedMac;
    if (
      expected.model.sha256 !== EMBEDDING_MODEL.sha256 ||
      expected.model.bytes !== EMBEDDING_MODEL.bytes
    )
      throw new EmbeddingError("embedding.resource-invalid");
    const root = isCompiledEntrypoint(Bun.main)
      ? dirname(process.execPath)
      : resolve(import.meta.dir, "../../../..", "dist");
    const directory = join(root, "native", `${process.platform}-${process.arch}`);
    const manifestPath = join(directory, "manifest.json");
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES)
      throw new EmbeddingError("embedding.resource-invalid");
    const actual: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!isDeepStrictEqual(actual, expected))
      throw new EmbeddingError("embedding.resource-invalid");
    const checks: (() => Promise<void>)[] = [];
    for (const file of expected.files) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(file.path))
        throw new EmbeddingError("embedding.resource-invalid");
      checks.push(
        await verifyResource(join(directory, file.path), file.bytes, file.sha256, signal),
      );
    }
    checks.push(
      await verifyResource(modelPath, EMBEDDING_MODEL.bytes, EMBEDDING_MODEL.sha256, signal),
    );
    return {
      executable: join(directory, expected.executable),
      buildIdentity: expected.buildIdentity,
      async assertUnchanged() {
        for (const check of checks) await check();
      },
    };
  } catch (error) {
    if (signal.aborted) throw new EmbeddingError("embedding.deadline-exceeded");
    throw error instanceof EmbeddingError
      ? error
      : new EmbeddingError("embedding.resource-invalid");
  }
}
export async function verifyResource(
  path: string,
  bytes: number,
  digest: string,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(bytes))
      throw new EmbeddingError("embedding.resource-invalid");
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > bytes) throw new EmbeddingError("embedding.resource-invalid");
      hash.update(chunk.subarray(0, bytesRead));
    }
    if (size !== bytes || hash.digest("hex") !== digest)
      throw new EmbeddingError("embedding.resource-invalid");
    const unchanged = async () => {
      try {
        const now = await lstat(path, { bigint: true });
        if (
          !now.isFile() ||
          now.isSymbolicLink() ||
          (["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const).some(
            (key) => now[key] !== before[key],
          )
        )
          throw new EmbeddingError("embedding.resource-invalid");
      } catch {
        throw new EmbeddingError("embedding.resource-invalid");
      }
    };
    await unchanged();
    return unchanged;
  } finally {
    await file.close();
  }
}
