import { isCompiledEntrypoint } from "./build-identity";
/* eslint-disable no-await-in-loop -- Digest reads must be bounded and ordered. */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  developmentEmbeddingArtifactDirectory,
  installedEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
} from "./native/embedding/catalog";
import {
  assertNativeArtifactMatch,
  assertSourceNativeArtifactMatch,
  NativeArtifactValidationError,
  verifyNativeArtifact,
} from "./native/embedding/manifest";
import { EmbeddingError, type ResourceFailure } from "../modules/embedding/errors";
import { EMBEDDING_MODEL } from "../modules/embedding/model";

const HASH_CHUNK_BYTES = 256 * 1024;

export interface EmbeddingResources {
  readonly executable: string;
  readonly buildIdentity: string;
  assertUnchanged(): Promise<void>;
}
type ResourceIdentity = Pick<ResourceFailure, "kind" | "file">;

/** Check the fixed native installation before starting a model transfer. */
export async function verifyNativeEmbeddingResources(
  signal: AbortSignal,
  options: { readonly compiledRoot?: string } = {},
): Promise<EmbeddingResources> {
  const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
  if (artifact === undefined) throw new EmbeddingError("embedding.native-resource-invalid");
  const target = artifact.id;
  try {
    const expected = artifact.manifest;
    if (
      expected.model.sha256 !== EMBEDDING_MODEL.sha256 ||
      expected.model.bytes !== EMBEDDING_MODEL.bytes
    )
      throw new NativeArtifactValidationError(
        "native manifest differs from the fixed model contract",
        "manifest.json",
        "manifest-mismatch",
      );
    const compiledEntrypoint = options.compiledRoot !== undefined || isCompiledEntrypoint(Bun.main);
    const root =
      options.compiledRoot ??
      (compiledEntrypoint
        ? await resolveCompiledEmbeddingResourceRoot(process.execPath)
        : undefined);
    const directory =
      root === undefined
        ? developmentEmbeddingArtifactDirectory(artifact)
        : installedEmbeddingArtifactDirectory(root, artifact);
    const actual = await verifyNativeArtifact(directory);
    if (compiledEntrypoint) assertNativeArtifactMatch(expected, actual);
    else assertSourceNativeArtifactMatch(expected, actual);
    const checks: (() => Promise<void>)[] = [];
    for (const file of actual.files) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(file.path))
        throw new NativeArtifactValidationError(
          "native file name is invalid",
          "manifest.json",
          "invalid",
        );
      checks.push(
        await verifyResource(join(directory, file.path), file.bytes, file.sha256, signal, {
          kind: "native",
          file: `native/${target}/${file.path}`,
        }),
      );
    }
    return {
      executable: join(directory, actual.executable),
      buildIdentity: actual.buildIdentity,
      async assertUnchanged() {
        for (const check of checks) await check();
      },
    };
  } catch (error) {
    if (signal.aborted) throw new EmbeddingError("embedding.deadline-exceeded");
    if (error instanceof EmbeddingError && error.code === "embedding.native-resource-invalid")
      throw error;
    const detail = error instanceof NativeArtifactValidationError ? error : undefined;
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    throw new EmbeddingError(
      "embedding.native-resource-invalid",
      { cause: error },
      {
        kind: "native",
        file: `native/${target}/${detail?.file ?? "manifest.json"}`,
        check: detail?.check ?? (missing ? "missing" : "invalid"),
        ...(detail?.expected === undefined ? {} : { expected: detail.expected }),
        ...(detail?.actual === undefined ? {} : { actual: detail.actual }),
      },
    );
  }
}

/** Pinned installation assets only. Config cannot select a native executable or manifest. */
export async function resolveEmbeddingResources(
  modelPath: string,
  signal: AbortSignal,
): Promise<EmbeddingResources> {
  const native = await verifyNativeEmbeddingResources(signal);
  const modelCheck = await verifyResource(
    modelPath,
    EMBEDDING_MODEL.bytes,
    EMBEDDING_MODEL.sha256,
    signal,
    { kind: "model", file: "model.gguf" },
  );
  return {
    executable: native.executable,
    buildIdentity: native.buildIdentity,
    async assertUnchanged() {
      await native.assertUnchanged();
      await modelCheck();
    },
  };
}

/** Resolve the real release directory when the user-facing command is a symlink. */
export async function resolveCompiledEmbeddingResourceRoot(
  executablePath: string,
): Promise<string> {
  return dirname(await realpath(executablePath));
}

export async function verifyResource(
  path: string,
  bytes: number,
  digest: string,
  signal: AbortSignal,
  resource?: ResourceIdentity,
): Promise<() => Promise<void>> {
  const invalid = (check: ResourceFailure["check"], expected?: string, actual?: string) =>
    new EmbeddingError(
      resource?.kind === "native"
        ? "embedding.native-resource-invalid"
        : "embedding.resource-invalid",
      undefined,
      resource === undefined
        ? undefined
        : {
            ...resource,
            check,
            ...(expected === undefined ? {} : { expected }),
            ...(actual === undefined ? {} : { actual }),
          },
    );
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (error: unknown) => {
      if (signal.aborted) throw error;
      throw invalid(
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "missing"
          : "invalid",
      );
    },
  );
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) throw invalid("invalid");
    if (before.size !== BigInt(bytes))
      throw invalid("size-mismatch", String(bytes), String(before.size));
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
          throw invalid("invalid");
      } catch {
        throw invalid("invalid");
      }
    };
    await unchanged();
    return unchanged;
  } catch (error) {
    if (signal.aborted || error instanceof EmbeddingError) throw error;
    throw invalid("invalid");
  } finally {
    await file.close();
  }
}
