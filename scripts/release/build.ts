import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  developmentEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
  type EmbeddingNativeArtifact,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import { compileReleaseCli } from "./compile-cli";
import { assertNativeArtifactMatch, verifyNativeArtifact } from "./native-manifest";

const repositoryRoot = resolve(import.meta.dir, "../..");

/** Build a runnable, unpacked platform directory. Archive and release publication stay separate. */
export async function buildReleaseStaging(): Promise<{
  readonly directory: string;
  readonly cli: string;
  readonly nativeBuild: string;
  readonly bundledInputs: readonly string[];
  readonly artifact: EmbeddingNativeArtifact;
}> {
  const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
  if (artifact === undefined)
    throw new Error(
      `release staging currently supports darwin-arm64, got ${process.platform}-${process.arch}`,
    );
  await runNativeBuild();
  const nativeDirectory = developmentEmbeddingArtifactDirectory(artifact);
  const manifest = await verifyNativeArtifact(nativeDirectory);
  const directory = join(repositoryRoot, "dist/release", artifact.id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const cli = join(directory, "lore");
  const compiled = await compileReleaseCli({ nativeManifest: manifest, outfile: cli, artifact });
  await cp(nativeDirectory, join(directory, "native", artifact.id), {
    recursive: true,
    force: true,
    dereference: false,
    preserveTimestamps: true,
  });
  assertNativeArtifactMatch(
    manifest,
    await verifyNativeArtifact(join(directory, "native", artifact.id)),
  );
  return Object.freeze({
    directory,
    cli,
    nativeBuild: manifest.buildIdentity,
    bundledInputs: compiled.bundledInputs,
    artifact,
  });
}

async function runNativeBuild(): Promise<void> {
  const child = Bun.spawn(
    [process.execPath, join(repositoryRoot, "scripts/native/build-embedding.ts")],
    {
      cwd: repositoryRoot,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0) throw new Error("native embedding build failed");
}

if (import.meta.main) {
  const result = await buildReleaseStaging();
  console.log(
    JSON.stringify({
      target: result.artifact.id,
      directory: result.directory,
      cli: result.cli,
      nativeBuild: result.nativeBuild,
    }),
  );
}
