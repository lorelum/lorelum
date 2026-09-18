import { chmod, mkdir, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BunPlugin } from "bun";
import {
  trustedEmbeddingManifestPath,
  type EmbeddingNativeArtifact,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";

const repositoryRoot = resolve(import.meta.dir, "../..");
const defaultEntrypoint = join(repositoryRoot, "packages/cli/src/main.ts");
const migrationAssetsDirectory = "packages/engine/src/persistence/migrations";
const windowsIcon = join(repositoryRoot, "scripts/release/lorelum.ico");

export function windowsCompileMetadataArguments(): readonly string[] {
  if (!existsSync(windowsIcon)) throw new Error(`Windows release icon is missing: ${windowsIcon}`);
  return Object.freeze([
    `--windows-icon=${windowsIcon}`,
    "--windows-title=Lorelum",
    "--windows-description=Lorelum local knowledge retrieval CLI",
  ]);
}

export interface CompileReleaseCliOptions {
  readonly nativeManifest: NativeArtifactManifest;
  readonly outfile: string;
  /** Native artifact whose checked-in manifest Bun replaces for this release. */
  readonly artifact: EmbeddingNativeArtifact;
  /** Test-only alternate entrypoint; release builds always use the CLI entrypoint. */
  readonly entrypoint?: string;
  /** Test-only alternate JSON artifact whose contents receive the trusted manifest. */
  readonly manifestArtifact?: string;
  /** Test-only compilation target; production derives this from the native artifact. */
  readonly target?: Bun.Build.CompileTarget;
}

export interface CompiledReleaseCli {
  /** The executable Bun actually wrote; Windows targets append ".exe" to the outfile. */
  readonly output: string;
  readonly bundledInputs: readonly string[];
}

/** Compile one CLI whose embedded manifest is byte-for-byte the staged native manifest. */
export async function compileReleaseCli(
  options: CompileReleaseCliOptions,
): Promise<CompiledReleaseCli> {
  const manifestArtifact = await realpath(
    options.manifestArtifact ?? trustedEmbeddingManifestPath(options.artifact),
  );
  await mkdir(dirname(options.outfile), { recursive: true });
  const entrypoint = options.entrypoint ?? defaultEntrypoint;
  const compileTarget = options.target ?? options.artifact.compileTarget;
  const plugin = manifestOverridePlugin(manifestArtifact, options.nativeManifest);
  if (process.platform === "win32") {
    return await compileBundledEntry(options, entrypoint, compileTarget, plugin);
  }
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "bun",
    compile: {
      target: compileTarget,
      outfile: options.outfile,
      assets: [migrationAssetsDirectory],
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    metafile: true,
    plugins: [plugin],
  });
  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new Error(`failed to compile release CLI${details ? `: ${details}` : ""}`);
  }
  return finishCompiledOutput(options, result.metafile);
}

/**
 * Bun 1.4.2's Bun.build compile API misbuilds Windows executables: the binary exits
 * immediately without running the entry module. Bundle with the manifest override
 * plugin first, then hand the single-file bundle to the compile command.
 */
async function compileBundledEntry(
  options: CompileReleaseCliOptions,
  entrypoint: string,
  compileTarget: Bun.Build.CompileTarget,
  plugin: BunPlugin,
): Promise<CompiledReleaseCli> {
  const bundleOutfile = `${options.outfile}.release-bundle.js`;
  try {
    const bundle = await Bun.build({
      entrypoints: [entrypoint],
      target: "bun",
      format: "esm",
      plugins: [plugin],
      metafile: true,
    });
    if (!bundle.success) {
      const details = bundle.logs.map((log) => log.message).join("\n");
      throw new Error(`failed to bundle release CLI${details ? `: ${details}` : ""}`);
    }
    // Plain builds keep outputs in memory; publish the single entry artifact to disk.
    const entryArtifact = bundle.outputs.find((output) => output.kind === "entry-point");
    if (entryArtifact === undefined) throw new Error("release bundle has no entry artifact");
    await Bun.write(bundleOutfile, entryArtifact);
    const child = Bun.spawnSync(
      [
        process.execPath,
        "build",
        "--compile",
        `--target=${compileTarget}`,
        "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig",
        ...windowsCompileMetadataArguments(),
        "--asset",
        migrationAssetsDirectory,
        bundleOutfile,
        "--outfile",
        options.outfile,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (child.exitCode !== 0)
      throw new Error(
        `release compile command failed: ${child.stdout.toString()}${child.stderr.toString()}`,
      );
    return finishCompiledOutput(options, bundle.metafile);
  } finally {
    await rm(bundleOutfile, { force: true });
  }
}

async function finishCompiledOutput(
  options: CompileReleaseCliOptions,
  metafile: Bun.BuildMetafile | null | undefined,
): Promise<CompiledReleaseCli> {
  // Bun appends ".exe" to the outfile for Windows compile targets.
  const output = existsSync(options.outfile) ? options.outfile : `${options.outfile}.exe`;
  await chmod(output, 0o755);
  if (!metafile) throw new Error("release compiler did not return bundle metadata");
  return Object.freeze({
    output,
    bundledInputs: Object.freeze(Object.keys(metafile.inputs).sort()),
  });
}

function manifestOverridePlugin(manifestArtifact: string, manifest: NativeArtifactManifest) {
  const contents = `${JSON.stringify(manifest)}\n`;
  return {
    name: "lorelum-release-native-manifest",
    setup(builder: Bun.PluginBuilder) {
      builder.onLoad({ filter: /\.json$/ }, async (args) => {
        if ((await realpath(args.path)) !== manifestArtifact) return;
        return { contents, loader: "json" };
      });
    },
  };
}
