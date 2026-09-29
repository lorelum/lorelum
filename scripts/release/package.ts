import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { releaseAssetNames } from "./assets";
import { buildReleaseStaging } from "./build";
import { renderThirdPartyNotices, collectBundledPackageNotices } from "./notices";
import {
  readNativeArtifactManifest,
  sha256File,
} from "../../packages/backend/src/runtime/native/embedding/manifest";

const repositoryRoot = resolve(import.meta.dir, "../..");
const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ReleaseArchive {
  readonly archive: string;
  readonly checksums: string;
  readonly metadata: string;
  readonly version: string;
}

interface BuildReleaseArchiveOptions {
  /** Test seam for keeping package output out of the working tree. */
  readonly repositoryRoot?: string;
  /** Test seam for packaging a prepared staging tree without compiling binaries. */
  readonly staging?: Awaited<ReturnType<typeof buildReleaseStaging>>;
}

/** Build one archive from a fresh native and CLI staging directory. */
export async function buildReleaseArchive(
  options: BuildReleaseArchiveOptions = {},
): Promise<ReleaseArchive> {
  const root = options.repositoryRoot ?? repositoryRoot;
  const version = await readCliVersion(root);
  const staging = options.staging ?? (await buildReleaseStaging());
  const target = staging.artifact.id;
  const windows = process.platform === "win32";
  const assetNames = releaseAssetNames(version, target, windows);
  const name = assetNames.packageName;
  const cliName = windows ? "lore.exe" : "lore";
  const tar = windows
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
  const packageDirectory = join(root, "dist/release/package");
  await rm(packageDirectory, { recursive: true, force: true });
  const packageRoot = join(packageDirectory, name);
  await mkdir(packageRoot, { recursive: true });
  await cp(staging.cli, join(packageRoot, cliName), {
    force: true,
    preserveTimestamps: true,
  });
  await cp(join(staging.directory, "native"), join(packageRoot, "native"), {
    recursive: true,
    force: true,
    dereference: false,
    preserveTimestamps: true,
  });
  await cp(join(root, "LICENSE"), join(packageRoot, "LICENSE"), {
    force: true,
    preserveTimestamps: true,
  });
  const installerName = windows ? "install.ps1" : "install.sh";
  await cp(join(root, installerName), join(packageRoot, installerName), {
    force: true,
    preserveTimestamps: true,
  });
  const notices = await collectBundledPackageNotices(staging.bundledInputs);
  await Bun.write(
    join(packageRoot, "THIRD_PARTY_NOTICES.txt"),
    renderThirdPartyNotices(Bun.version, notices),
  );

  const artifactsDirectory = join(root, "dist/release/artifacts");
  await rm(artifactsDirectory, { recursive: true, force: true });
  await mkdir(artifactsDirectory, { recursive: true });
  const archive = join(artifactsDirectory, assetNames.archiveFileName);
  const archiveArguments = windows
    ? [tar, "-C", dirname(packageRoot), "-a", "-cf", archive, name]
    : [tar, "-C", dirname(packageRoot), "-czf", archive, name];
  const archiveResult = Bun.spawnSync(archiveArguments, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (archiveResult.exitCode !== 0)
    throw new Error(`release archive creation failed: ${archiveResult.stderr.toString()}`);
  const archiveSha256 = await sha256File(archive);
  const nativeManifest = await readNativeArtifactManifest(join(packageRoot, "native", target));
  const metadata = join(artifactsDirectory, assetNames.metadataFileName);
  await Bun.write(
    metadata,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version,
        target,
        bunVersion: Bun.version,
        nativeBuildIdentity: nativeManifest.buildIdentity,
        nativeManifestSha256: await sha256File(
          join(packageRoot, "native", target, "manifest.json"),
        ),
        cliSha256: await sha256File(join(packageRoot, cliName)),
        archive: {
          fileName: assetNames.archiveFileName,
          bytes: (await stat(archive)).size,
          sha256: archiveSha256,
        },
      },
      null,
      2,
    )}\n`,
  );
  const checksums = join(artifactsDirectory, "SHA256SUMS");
  const metadataSha256 = await sha256File(metadata);
  await Bun.write(
    checksums,
    `${archiveSha256}  ${assetNames.archiveFileName}\n${metadataSha256}  ${assetNames.metadataFileName}\n`,
  );
  return Object.freeze({ archive, checksums, metadata, version });
}

async function readCliVersion(root: string): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(join(root, "packages/cli/package.json"), "utf8"),
  );
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    typeof (manifest as Record<string, unknown>).version !== "string"
  ) {
    throw new Error("CLI package version is missing");
  }
  const version = (manifest as Record<string, unknown>).version as string;
  if (!versionPattern.test(version)) throw new Error("CLI package version is not valid SemVer");
  return version;
}

if (import.meta.main) console.log(JSON.stringify(await buildReleaseArchive()));
