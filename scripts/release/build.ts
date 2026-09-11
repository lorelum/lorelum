import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileReleaseCli } from "./compile-cli";
import { assertNativeArtifactMatch, verifyNativeArtifact } from "./native-manifest";

const repositoryRoot = resolve(import.meta.dir, "../..");
const target = "darwin-arm64";

/** Build a runnable, unpacked platform directory. Archive and release publication stay separate. */
export async function buildReleaseStaging(): Promise<{
  readonly directory: string;
  readonly cli: string;
  readonly nativeBuild: string;
  readonly bundledInputs: readonly string[];
}> {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      `release staging currently supports darwin-arm64, got ${process.platform}-${process.arch}`,
    );
  await runNativeBuild();
  const nativeDirectory = join(repositoryRoot, "dist/native", target);
  const manifest = await verifyNativeArtifact(nativeDirectory);
  const directory = join(repositoryRoot, "dist/release", target);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const cli = join(directory, "lore");
  const compiled = await compileReleaseCli({ nativeManifest: manifest, outfile: cli });
  await cp(nativeDirectory, join(directory, "native", target), {
    recursive: true,
    force: true,
    dereference: false,
    preserveTimestamps: true,
  });
  assertNativeArtifactMatch(
    manifest,
    await verifyNativeArtifact(join(directory, "native", target)),
  );
  return Object.freeze({
    directory,
    cli,
    nativeBuild: manifest.buildIdentity,
    bundledInputs: compiled.bundledInputs,
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
      target,
      directory: result.directory,
      cli: result.cli,
      nativeBuild: result.nativeBuild,
    }),
  );
}
