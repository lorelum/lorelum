import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { resolveEmbeddingNativeArtifact } from "../../packages/backend/src/runtime/native/embedding/catalog";
import { buildReleaseArchive } from "./package";

const repositoryRoot = join(import.meta.dir, "..", "..");
const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);

test.skipIf(artifact === undefined)(
  "release archive contains only the current platform installer and checksums cover it",
  async () => {
    if (artifact === undefined) return;

    const root = await mkdtemp(join(tmpdir(), "lore-release-package-"));
    const stagingDirectory = join(root, "staging");
    const cli = join(stagingDirectory, process.platform === "win32" ? "lore.exe" : "lore");
    const nativeDirectory = join(stagingDirectory, "native", artifact.id);
    const windows = process.platform === "win32";
    const installerName = windows ? "install.ps1" : "install.sh";
    const otherInstallerName = windows ? "install.sh" : "install.ps1";

    try {
      await mkdir(join(root, "packages", "cli"), { recursive: true });
      await mkdir(nativeDirectory, { recursive: true });
      await writeFile(join(root, "packages", "cli", "package.json"), '{"version":"0.1.0-test"}\n');
      await writeFile(join(root, "LICENSE"), "Apache-2.0 fixture\n");
      await copyFile(join(repositoryRoot, installerName), join(root, installerName));
      await writeFile(cli, "CLI fixture\n");
      await writeFile(
        join(nativeDirectory, "manifest.json"),
        `${JSON.stringify(artifact.manifest)}\n`,
      );
      await writeFile(join(nativeDirectory, artifact.manifest.executable), "native fixture\n");
      if (!windows) await chmod(join(nativeDirectory, artifact.manifest.executable), 0o755);

      const release = await buildReleaseArchive({
        repositoryRoot: root,
        staging: {
          directory: stagingDirectory,
          cli,
          nativeBuild: artifact.manifest.buildIdentity,
          bundledInputs: [],
          artifact,
        },
      });

      const tar = windows
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
        : "tar";
      const packageName = `lore-${release.version}-${artifact.id}`;
      const listing = Bun.spawnSync([tar, windows ? "-tf" : "-tzf", release.archive], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(listing.exitCode).toBe(0);
      const entries = listing.stdout
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((entry) => entry.replaceAll("\\", "/"));
      expect(entries).toContain(`${packageName}/${installerName}`);
      expect(entries).not.toContain(`${packageName}/${otherInstallerName}`);

      const checksumLines = (await readFile(release.checksums, "utf8")).trim().split("\n");
      const archiveChecksum = checksumLines.find((line) =>
        line.endsWith(`  ${basename(release.archive)}`),
      );
      expect(archiveChecksum).toBeDefined();
      expect(archiveChecksum?.split(/\s+/)[0]).toBe(
        createHash("sha256")
          .update(await readFile(release.archive))
          .digest("hex"),
      );

      const extracted = join(root, "extracted");
      await mkdir(extracted);
      const extraction = Bun.spawnSync(
        windows
          ? [tar, "-xf", release.archive, "-C", extracted]
          : [tar, "-xzf", release.archive, "-C", extracted],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(extraction.exitCode).toBe(0);
      expect(await readFile(join(extracted, packageName, installerName), "utf8")).toBe(
        await readFile(join(root, installerName), "utf8"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
