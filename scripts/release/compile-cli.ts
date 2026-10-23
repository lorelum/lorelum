import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { readBuildProvenance } from "../../packages/backend/src/runtime/build-info";
import type { EmbeddingNativeArtifact } from "../../packages/backend/src/runtime/native/embedding/catalog";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";
import { toolVersion } from "../../packages/cli/src/output/protocol";

const repositoryRoot = resolve(import.meta.dir, "../..");
const defaultEntrypoint = join(repositoryRoot, "packages/cli/src/main.ts");
const migrationAssetsDirectory = "packages/engine/src/persistence/migrations";
const windowsIcon = join(repositoryRoot, "scripts/release/lorelum.ico");
const compiledManifestDefinitionKey = "LORELUM_RELEASE_NATIVE_MANIFEST";
const compiledProvenanceDefinitionKey = "LORELUM_BUILD_PROVENANCE";

export function windowsCompileMetadataArguments(): readonly string[] {
  if (!existsSync(windowsIcon)) throw new Error(`Windows release icon is missing: ${windowsIcon}`);
  return Object.freeze([
    `--windows-icon=${windowsIcon}`,
    "--windows-title=Lorelum",
    "--windows-description=Lorelum local knowledge retrieval CLI",
  ]);
}

export interface CompileCliOptions {
  readonly outfile: string;
  /** Test-only alternate entrypoint; normal builds use the CLI entrypoint. */
  readonly entrypoint?: string;
  /** Test-only alternate target; normal builds target the current platform. */
  readonly target?: Bun.Build.CompileTarget;
  /** Test-only override for validating the Windows-compatible Bun CLI compiler path. */
  readonly useBunCommand?: true;
}

export interface CompileReleaseCliOptions {
  readonly nativeManifest: NativeArtifactManifest;
  readonly outfile: string;
  /** Native artifact whose checked-in manifest the release replaces at startup. */
  readonly artifact: EmbeddingNativeArtifact;
  /** Test-only alternate entrypoint; release builds always use the CLI entrypoint. */
  readonly entrypoint?: string;
  /** Test-only compilation target; production derives this from the native artifact. */
  readonly target?: Bun.Build.CompileTarget;
  /** Test-only override for validating the Windows-compatible Bun CLI compiler path. */
  readonly useBunCommand?: true;
}

export interface CompiledCli {
  /** The executable Bun actually wrote; Windows targets append ".exe" to the outfile. */
  readonly output: string;
  readonly bundledInputs: readonly string[];
}

export type CompiledReleaseCli = CompiledCli;

/** Compile one standalone CLI with readable source-mapped runtime stacks. */
export async function compileCli(options: CompileCliOptions): Promise<CompiledCli> {
  const job = await createCompileJob(options);
  if (options.useBunCommand === true || process.platform === "win32") {
    return compileWithBunCommand(job, { define: job.define });
  }
  return compileWithBuildApi(job, job.define);
}

/** Compile one CLI whose embedded manifest is byte-for-byte the staged native manifest. */
export async function compileReleaseCli(
  options: CompileReleaseCliOptions,
): Promise<CompiledReleaseCli> {
  const job = await createCompileJob({
    outfile: options.outfile,
    ...(options.entrypoint === undefined ? {} : { entrypoint: options.entrypoint }),
    target: options.target ?? options.artifact.compileTarget,
  });
  const define = {
    ...job.define,
    ...releaseManifestDefine(options.artifact, options.nativeManifest),
  };
  if (options.useBunCommand === true || process.platform === "win32") {
    return compileWithBunCommand(job, { define });
  }
  return compileWithBuildApi(job, define);
}

async function createCompileJob(options: CompileCliOptions): Promise<CompileCliJob> {
  await mkdir(dirname(options.outfile), { recursive: true });
  const provenance = await readBuildProvenance(repositoryRoot, toolVersion, "compiled");
  return {
    outfile: options.outfile,
    entrypoint: options.entrypoint ?? defaultEntrypoint,
    compileTarget:
      options.target ?? (`bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget),
    // One identity per compilation, shared by all processes launched from that binary.
    define: {
      LORELUM_BUILD_IDENTITY: JSON.stringify(randomBytes(32).toString("hex")),
      [compiledProvenanceDefinitionKey]: JSON.stringify(provenance),
    },
  };
}

async function compileWithBuildApi(
  job: CompileCliJob,
  define?: CompileDefinitions,
): Promise<CompiledCli> {
  const result = await Bun.build({
    entrypoints: [job.entrypoint],
    target: "bun",
    sourcemap: "inline",
    minify: false,
    ...(define === undefined ? {} : { define }),
    compile: {
      target: job.compileTarget,
      outfile: job.outfile,
      assets: [migrationAssetsDirectory],
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    metafile: true,
  });
  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new Error(`failed to compile CLI${details ? `: ${details}` : ""}`);
  }
  return finishCompiledOutput(job, result.metafile);
}

/**
 * Bun 1.4.2's Bun.build compile API misbuilds Windows executables: the binary exits
 * immediately without running the entry module. The CLI compiler does run correctly
 * there, so both compiler paths use the same static manifest definition and compile the
 * original TypeScript entrypoint instead of an intermediate bundle.
 */
async function compileWithBunCommand(
  job: CompileCliJob,
  options: CompileWithBunCommandOptions = {},
): Promise<CompiledCli> {
  const child = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      `--target=${job.compileTarget}`,
      "--sourcemap=inline",
      "--no-minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      ...(job.compileTarget.startsWith("bun-windows-") ? windowsCompileMetadataArguments() : []),
      ...compileDefinitionArguments(options.define),
      "--asset",
      migrationAssetsDirectory,
      job.entrypoint,
      "--outfile",
      job.outfile,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (child.exitCode !== 0) {
    throw new Error(
      `release compile command failed: ${child.stdout.toString()}${child.stderr.toString()}`,
    );
  }
  const bundle = await Bun.build({
    entrypoints: [job.entrypoint],
    target: "bun",
    metafile: true,
    ...(options.define === undefined ? {} : { define: options.define }),
  });
  if (!bundle.success) {
    const details = bundle.logs.map((log) => log.message).join("\n");
    throw new Error(`failed to inspect compiled CLI inputs${details ? `: ${details}` : ""}`);
  }
  return finishCompiledOutput(job, bundle.metafile);
}

type CompileDefinitions = Readonly<Record<string, string>>;

interface CompileCliJob {
  readonly outfile: string;
  readonly entrypoint: string;
  readonly compileTarget: Bun.Build.CompileTarget;
  readonly define: CompileDefinitions;
}

interface CompileWithBunCommandOptions {
  readonly define?: CompileDefinitions;
}

function releaseManifestDefine(
  artifact: EmbeddingNativeArtifact,
  manifest: NativeArtifactManifest,
): CompileDefinitions {
  return Object.freeze({
    [compiledManifestDefinitionKey]: JSON.stringify(
      JSON.stringify({ artifactId: artifact.id, manifest }),
    ),
  });
}

function compileDefinitionArguments(define: CompileDefinitions | undefined): readonly string[] {
  if (define === undefined) return [];
  return Object.entries(define).flatMap(([key, value]) => ["--define", `${key}=${value}`]);
}

async function finishCompiledOutput(
  options: Pick<CompileCliJob, "outfile">,
  metafile: Bun.BuildMetafile | null | undefined,
): Promise<CompiledCli> {
  // Bun appends ".exe" to the outfile for Windows compile targets.
  const output = existsSync(options.outfile) ? options.outfile : `${options.outfile}.exe`;
  await chmod(output, 0o755);
  if (!metafile) throw new Error("release compiler did not return bundle metadata");
  return Object.freeze({
    output,
    bundledInputs: Object.freeze(Object.keys(metafile.inputs).sort()),
  });
}
