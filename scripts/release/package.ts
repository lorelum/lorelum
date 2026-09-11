import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildReleaseStaging } from "./build";
import { renderThirdPartyNotices, collectBundledPackageNotices } from "./notices";
import { readNativeArtifactManifest, sha256File } from "./native-manifest";

const repositoryRoot = resolve(import.meta.dir, "../..");
const target = "darwin-arm64";
const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ReleaseArchive {
  readonly archive: string;
  readonly checksums: string;
  readonly metadata: string;
  readonly version: string;
}

/** Build one archive from a fresh native and CLI staging directory. */
export async function buildReleaseArchive(): Promise<ReleaseArchive> {
  const version = await readCliVersion();
  const staging = await buildReleaseStaging();
  const name = `lore-${version}-${target}`;
  const packageDirectory = join(repositoryRoot, "dist/release/package");
  await rm(packageDirectory, { recursive: true, force: true });
  const packageRoot = join(packageDirectory, name);
  await mkdir(packageRoot, { recursive: true });
  await cp(staging.cli, join(packageRoot, "lore"), { force: true, preserveTimestamps: true });
  await cp(join(staging.directory, "native"), join(packageRoot, "native"), {
    recursive: true,
    force: true,
    dereference: false,
    preserveTimestamps: true,
  });
  await cp(join(repositoryRoot, "LICENSE"), join(packageRoot, "LICENSE"), {
    force: true,
    preserveTimestamps: true,
  });
  const notices = await collectBundledPackageNotices(staging.bundledInputs);
  await Bun.write(
    join(packageRoot, "THIRD_PARTY_NOTICES.txt"),
    renderThirdPartyNotices(Bun.version, notices),
  );

  const artifactsDirectory = join(repositoryRoot, "dist/release/artifacts");
  await rm(artifactsDirectory, { recursive: true, force: true });
  await mkdir(artifactsDirectory, { recursive: true });
  const archive = join(artifactsDirectory, `${name}.tar.gz`);
  const archiveResult = Bun.spawnSync(["tar", "-C", dirname(packageRoot), "-czf", archive, name], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (archiveResult.exitCode !== 0)
    throw new Error(`release archive creation failed: ${archiveResult.stderr.toString()}`);
  const archiveSha256 = await sha256File(archive);
  const checksums = join(artifactsDirectory, "SHA256SUMS");
  await Bun.write(checksums, `${archiveSha256}  ${name}.tar.gz\n`);
  const nativeManifest = await readNativeArtifactManifest(join(packageRoot, "native", target));
  const metadata = join(artifactsDirectory, "release-metadata.json");
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
        cliSha256: await sha256File(join(packageRoot, "lore")),
        archive: {
          fileName: `${name}.tar.gz`,
          bytes: (await stat(archive)).size,
          sha256: archiveSha256,
        },
      },
      null,
      2,
    )}\n`,
  );
  return Object.freeze({ archive, checksums, metadata, version });
}

async function readCliVersion(): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(join(repositoryRoot, "packages/cli/package.json"), "utf8"),
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
