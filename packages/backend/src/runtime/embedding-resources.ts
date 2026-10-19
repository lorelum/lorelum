import { isCompiledEntrypoint } from "./build-identity";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ResolvedEmbeddingConfig } from "../config/embedding";
import { prepareModel } from "../models/prepare";
import type { ModelProgress } from "../modules/embedding/dto";
import {
  developmentEmbeddingArtifactDirectory,
  installedEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
} from "./native/embedding/catalog";
import {
  assertNativeArtifactMatch,
  assertSourceNativeArtifactMatch,
  NativeArtifactValidationError,
  readNativeArtifactManifest,
} from "./native/embedding/manifest";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL, type PreparedEmbeddingResources } from "../modules/embedding/model";
import { verifyResource } from "./resource-integrity";

/** Preparation owns all file validation before handing resources to the process lifetime. */
export async function prepareEmbeddingResources(
  config: ResolvedEmbeddingConfig,
  signal: AbortSignal,
  progress: (value: ModelProgress) => void,
  options: {
    readonly compiledRoot?: string;
    /** Source-run fixture seam; production uses the fixed development catalog directory. */
    readonly developmentDirectory?: string;
    readonly model?: Parameters<typeof prepareModel>[3];
  } = {},
): Promise<PreparedEmbeddingResources> {
  const native = await verifyNativeEmbeddingResources(signal, options);
  const modelPath = await prepareModel(config, signal, progress, options.model);
  return { modelPath, ...native };
}

/** Check only the matching manifest and executable before starting a model transfer. */
export async function verifyNativeEmbeddingResources(
  signal: AbortSignal,
  options: { readonly compiledRoot?: string; readonly developmentDirectory?: string } = {},
): Promise<Pick<PreparedEmbeddingResources, "executable" | "buildIdentity">> {
  const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
  if (artifact === undefined) throw new EmbeddingError("embedding.native-resource-invalid");
  const target = artifact.id;
  try {
    signal.throwIfAborted();
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
        ? (options.developmentDirectory ?? developmentEmbeddingArtifactDirectory(artifact))
        : installedEmbeddingArtifactDirectory(root, artifact);
    const actual = await readNativeArtifactManifest(directory);
    if (compiledEntrypoint) assertNativeArtifactMatch(expected, actual);
    else assertSourceNativeArtifactMatch(expected, actual);
    const executable = actual.files.find((file) => file.path === actual.executable);
    if (!executable)
      throw new NativeArtifactValidationError(
        "native executable is missing from the manifest",
        actual.executable,
        "invalid",
      );
    await verifyResource(
      join(directory, executable.path),
      executable.bytes,
      executable.sha256,
      signal,
      { kind: "native", file: `native/${target}/${executable.path}` },
    );
    return {
      executable: join(directory, actual.executable),
      buildIdentity: actual.buildIdentity,
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

/** Resolve the real release directory when the user-facing command is a symlink. */
export async function resolveCompiledEmbeddingResourceRoot(
  executablePath: string,
): Promise<string> {
  return dirname(await realpath(executablePath));
}
