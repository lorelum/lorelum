import { chmod, mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  trustedEmbeddingManifestPath,
  type EmbeddingNativeArtifact,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";

const repositoryRoot = resolve(import.meta.dir, "../..");
const defaultEntrypoint = join(repositoryRoot, "packages/cli/src/main.ts");

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
  const result = await Bun.build({
    entrypoints: [options.entrypoint ?? defaultEntrypoint],
    target: "bun",
    compile: {
      target: options.target ?? options.artifact.compileTarget,
      outfile: options.outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    metafile: true,
    plugins: [manifestOverridePlugin(manifestArtifact, options.nativeManifest)],
  });
  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new Error(`failed to compile release CLI${details ? `: ${details}` : ""}`);
  }
  await chmod(options.outfile, 0o755);
  if (!result.metafile) throw new Error("release compiler did not return bundle metadata");
  return Object.freeze({
    bundledInputs: Object.freeze(Object.keys(result.metafile.inputs).sort()),
  });
}

function manifestOverridePlugin(manifestArtifact: string, manifest: NativeArtifactManifest) {
  const filter = new RegExp(`^${escapeRegExp(manifestArtifact)}$`);
  const contents = `${JSON.stringify(manifest)}\n`;
  return {
    name: "lorelum-release-native-manifest",
    setup(builder: Bun.PluginBuilder) {
      builder.onLoad({ filter }, () => ({ contents, loader: "json" }));
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
