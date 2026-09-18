/* eslint-disable no-await-in-loop -- Release fixtures are assembled deterministically before serving assets. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = "0.1.0-alpha.1";
const upgradeVersion = "0.1.0-alpha.3";
const stableVersion = "0.1.0";
const repositoryRoot = join(import.meta.dir, "..", "..");

// The POSIX installer runs under Git Bash on Windows hosts, where MSYS shasum emits
// a leading mode marker that its parsing does not accept; Windows installs use
// install.ps1 instead, which install-ps1.integration.test.ts covers.
const posixOnly = process.platform !== "win32";
const nativeMacArm64 = process.platform === "darwin" && process.arch === "arm64";

const platforms = {
  "darwin-arm64": { unameS: "Darwin", unameM: "arm64" },
  "linux-x64": { unameS: "Linux", unameM: "x86_64" },
} as const;
type InstallerPlatform = keyof typeof platforms;

test.skipIf(!posixOnly)(
  "installer verifies, extracts, and atomically links one platform package",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-integration-"));
    const server = await createReleaseServer(root);
    try {
      const result = await runInstaller(root, server.url.origin);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const command = join(root, "bin", "lore");
      expect(await realpath(command)).toBe(
        await realpath(join(root, "share", "versions", version, "lore")),
      );
      expect(await readFile(join(root, "share", "versions", version, "LICENSE"), "utf8")).toBe(
        "Apache-2.0 fixture\n",
      );
      expect(result.stdout).toContain(`Installed lore ${version}`);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!nativeMacArm64)(
  "installer runs on the supported macOS host without a platform shim",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-native-macos-"));
    const server = await createReleaseServer(root);
    try {
      const result = await runInstaller(
        root,
        server.url.origin,
        ["--version", version],
        "darwin-arm64",
        {},
        true,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(await realpath(join(root, "bin", "lore"))).toBe(
        await realpath(join(root, "share", "versions", version, "lore")),
      );
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)("installer installs the linux-x64 package on Linux x86_64", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-linux-"));
  const server = await createReleaseServer(root, { platform: "linux-x64" });
  try {
    const result = await runInstaller(root, server.url.origin, ["--version", version], "linux-x64");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Installed lore ${version}`);
    expect(
      await readFile(
        join(root, "share", "versions", version, "native", "linux-x64", "manifest.json"),
        "utf8",
      ),
    ).toBe("{}\n");
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!posixOnly)(
  "installer resolves the latest stable release when no version is supplied",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-latest-"));
    const server = await createReleaseServer(root, { version: stableVersion });
    try {
      const result = await runInstaller(root, server.url.origin, []);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(
        Bun.file(join(root, "share", "versions", stableVersion, "lore")).exists(),
      ).resolves.toBe(true);
      expect(result.stdout).toContain(`Installed lore ${stableVersion}`);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)(
  "installer uses the exact tag returned for the latest release assets",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-latest-tag-"));
    const server = await createReleaseServer(root, {
      version: stableVersion,
      latestTag: stableVersion,
      releaseTag: stableVersion,
    });
    try {
      const result = await runInstaller(root, server.url.origin, []);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Installed lore ${stableVersion}`);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)(
  "installer rejects a latest-release tag that is not semantic versioning",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-invalid-latest-"));
    const server = await createReleaseServer(root, { latestTag: "release-candidate" });
    try {
      const result = await runInstaller(root, server.url.origin, []);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cannot resolve the latest stable release");
      await expect(
        Bun.file(join(root, "share", "versions", version, "lore")).exists(),
      ).resolves.toBe(false);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)("installer leaves an unmanaged command untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-conflict-"));
  const server = await createReleaseServer(root);
  try {
    await mkdir(join(root, "bin"), { recursive: true });
    const command = join(root, "bin", "lore");
    const stopLog = join(root, "backend-stop.log");
    await writeFile(command, "foreign\n");
    const result = await runInstaller(
      root,
      server.url.origin,
      ["--version", version],
      "darwin-arm64",
      {
        LORELUM_INSTALL_TEST_COMMAND_PATH: command,
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(await readFile(command, "utf8")).toBe("foreign\n");
    await expect(Bun.file(join(root, "share", "versions", version, "lore")).exists()).resolves.toBe(
      false,
    );
    await expect(Bun.file(stopLog).exists()).resolves.toBe(false);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!posixOnly)("installer never executes a forged managed-link target", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-forged-link-"));
  const server = await createReleaseServer(root);
  try {
    const command = join(root, "bin", "lore");
    const marker = join(root, "forged-target-ran.txt");
    const foreign = join(root, "share", "foreign", "lore");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "share", "foreign"), { recursive: true });
    await writeFile(foreign, `#!/bin/sh\nprintf '%s' ran > "${marker}"\n`);
    await chmod(foreign, 0o755);
    await symlink(join(root, "share", "versions", "..", "..", "foreign", "lore"), command);

    const result = await runInstaller(root, server.url.origin);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("existing command is not managed by Lorelum");
    await expect(Bun.file(marker).exists()).resolves.toBe(false);
    await expect(Bun.file(join(root, "share", "versions", version, "lore")).exists()).resolves.toBe(
      false,
    );
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!posixOnly)(
  "installer stops the managed old release before activating an upgrade",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-upgrade-"));
    const server = await createReleaseServer(root, { versions: [version, upgradeVersion] });
    try {
      const command = join(root, "bin", "lore");
      const stopLog = join(root, "backend-stop.log");
      const environment = {
        LORELUM_INSTALL_TEST_COMMAND_PATH: command,
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
      };
      expect(
        (
          await runInstaller(
            root,
            server.url.origin,
            ["--version", version],
            "darwin-arm64",
            environment,
          )
        ).exitCode,
      ).toBe(0);

      const result = await runInstaller(
        root,
        server.url.origin,
        ["--version", upgradeVersion],
        "darwin-arm64",
        environment,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Stopping the existing Lorelum Backend before upgrading.");
      expect(await realpath(command)).toBe(
        await realpath(join(root, "share", "versions", upgradeVersion, "lore")),
      );
      expect(await readFile(stopLog, "utf8")).toBe(
        `${join(root, "share", "versions", version, "lore")}|${join(root, "share", "versions", version, "lore")}\n`,
      );
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)(
  "installer falls back to the verified candidate when the old release cannot stop",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-upgrade-fallback-"));
    const server = await createReleaseServer(root, {
      versions: [version, upgradeVersion],
      stopExitCodes: { [version]: 1, [upgradeVersion]: 0 },
    });
    try {
      const command = join(root, "bin", "lore");
      const stopLog = join(root, "backend-stop.log");
      const environment = {
        LORELUM_INSTALL_TEST_COMMAND_PATH: command,
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
      };
      expect(
        (
          await runInstaller(
            root,
            server.url.origin,
            ["--version", version],
            "darwin-arm64",
            environment,
          )
        ).exitCode,
      ).toBe(0);

      const result = await runInstaller(
        root,
        server.url.origin,
        ["--version", upgradeVersion],
        "darwin-arm64",
        environment,
      );
      expect(result.exitCode).toBe(0);
      expect(await realpath(command)).toBe(
        await realpath(join(root, "share", "versions", upgradeVersion, "lore")),
      );
      const stops = (await readFile(stopLog, "utf8")).trim().split("\n");
      expect(stops).toHaveLength(2);
      expect(stops[0]).toBe(
        `${join(root, "share", "versions", version, "lore")}|${join(root, "share", "versions", version, "lore")}`,
      );
      expect(stops[1]).toStartWith(join(root, "share", ".lore-install."));
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)(
  "installer keeps the old entry when neither release can stop the Backend",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-upgrade-stop-failure-"));
    const server = await createReleaseServer(root, {
      versions: [version, upgradeVersion],
      stopExitCodes: { [version]: 1, [upgradeVersion]: 1 },
    });
    try {
      const command = join(root, "bin", "lore");
      const stopLog = join(root, "backend-stop.log");
      const environment = {
        LORELUM_INSTALL_TEST_COMMAND_PATH: command,
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
      };
      expect(
        (
          await runInstaller(
            root,
            server.url.origin,
            ["--version", version],
            "darwin-arm64",
            environment,
          )
        ).exitCode,
      ).toBe(0);
      const oldCli = await readFile(join(root, "share", "versions", version, "lore"));

      const result = await runInstaller(
        root,
        server.url.origin,
        ["--version", upgradeVersion],
        "darwin-arm64",
        environment,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cannot safely stop the existing Lorelum Backend");
      expect(result.stderr).toContain(`"${command}" backend stop`);
      expect(result.stderr).toContain("backend.incompatible");
      expect(await realpath(command)).toBe(
        await realpath(join(root, "share", "versions", version, "lore")),
      );
      expect(await readFile(join(root, "share", "versions", version, "lore"))).toEqual(oldCli);
      expect((await readFile(stopLog, "utf8")).trim().split("\n")).toHaveLength(2);
      await expect(
        Bun.file(join(root, "share", "versions", upgradeVersion, "lore")).exists(),
      ).resolves.toBe(false);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)(
  "installer validates a target-version conflict before it stops the old Backend",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-upgrade-destination-conflict-"));
    const server = await createReleaseServer(root, { versions: [version, upgradeVersion] });
    try {
      const command = join(root, "bin", "lore");
      const stopLog = join(root, "backend-stop.log");
      const environment = {
        LORELUM_INSTALL_TEST_COMMAND_PATH: command,
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
      };
      expect(
        (
          await runInstaller(
            root,
            server.url.origin,
            ["--version", version],
            "darwin-arm64",
            environment,
          )
        ).exitCode,
      ).toBe(0);
      await mkdir(join(root, "share", "versions", upgradeVersion), { recursive: true });
      await writeFile(
        join(root, "share", "versions", upgradeVersion, "lore"),
        "different release\n",
      );

      const result = await runInstaller(
        root,
        server.url.origin,
        ["--version", upgradeVersion],
        "darwin-arm64",
        environment,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("existing version differs from the verified archive");
      expect(await realpath(command)).toBe(
        await realpath(join(root, "share", "versions", version, "lore")),
      );
      await expect(Bun.file(stopLog).exists()).resolves.toBe(false);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!posixOnly)("same-release reinstall does not stop the Backend", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-same-version-"));
  const server = await createReleaseServer(root);
  try {
    const command = join(root, "bin", "lore");
    const stopLog = join(root, "backend-stop.log");
    const environment = {
      LORELUM_INSTALL_TEST_COMMAND_PATH: command,
      LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
    };
    expect(
      (
        await runInstaller(
          root,
          server.url.origin,
          ["--version", version],
          "darwin-arm64",
          environment,
        )
      ).exitCode,
    ).toBe(0);
    expect(
      (
        await runInstaller(
          root,
          server.url.origin,
          ["--version", version],
          "darwin-arm64",
          environment,
        )
      ).exitCode,
    ).toBe(0);
    await expect(Bun.file(stopLog).exists()).resolves.toBe(false);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

async function createReleaseServer(
  root: string,
  options: {
    version?: string;
    versions?: readonly string[];
    latestTag?: string;
    releaseTag?: string;
    platform?: InstallerPlatform;
    stopExitCodes?: Readonly<Record<string, number>>;
  } = {},
) {
  const platform = options.platform ?? "darwin-arm64";
  const releaseVersions = options.versions ?? [options.version ?? version];
  const latestVersion = options.version ?? releaseVersions[0]!;
  const releaseAssets = new Map<string, { archive: string; checksums: string }>();
  for (const releaseVersion of releaseVersions) {
    const archiveName = `lore-${releaseVersion}-${platform}.tar.gz`;
    const packageName = archiveName.slice(0, -".tar.gz".length);
    const releaseTag = options.releaseTag ?? `v${releaseVersion}`;
    const releases = join(root, "releases", releaseTag);
    const packageDirectory = join(root, packageName);
    await mkdir(join(packageDirectory, "native", platform), { recursive: true });
    const stopExitCode = options.stopExitCodes?.[releaseVersion] ?? 0;
    await writeFile(
      join(packageDirectory, "lore"),
      `#!/bin/sh\nif [ "${"$1"}" = backend ] && [ "${"$2"}" = stop ]; then\n  if [ -n "${"${LORELUM_INSTALL_TEST_STOP_LOG:-}"}" ]; then\n    printf '%s|%s\\n' "$0" "$(readlink "${"${LORELUM_INSTALL_TEST_COMMAND_PATH:-}"}" 2>/dev/null || true)" >> "$LORELUM_INSTALL_TEST_STOP_LOG"\n  fi\n  if [ ${stopExitCode} -ne 0 ]; then\n    printf '%s\\n' '{"error":{"code":"backend.incompatible"}}' >&2\n  fi\n  exit ${stopExitCode}\nfi\nexit 0\n`,
    );
    await writeFile(join(packageDirectory, "LICENSE"), "Apache-2.0 fixture\n");
    await writeFile(join(packageDirectory, "THIRD_PARTY_NOTICES.txt"), "notices\n");
    await writeFile(
      join(packageDirectory, "native", platform, "lore-model"),
      "#!/bin/sh\nexit 0\n",
    );
    await writeFile(join(packageDirectory, "native", platform, "manifest.json"), "{}\n");
    await chmod(join(packageDirectory, "lore"), 0o755);
    await chmod(join(packageDirectory, "native", platform, "lore-model"), 0o755);
    await mkdir(releases, { recursive: true });
    const archive = join(releases, archiveName);
    const archived = Bun.spawnSync(["tar", "-C", root, "-czf", archive, packageName]);
    if (archived.exitCode !== 0) throw new Error("fixture archive creation failed");
    const sha256 = createHash("sha256")
      .update(Buffer.from(await Bun.file(archive).arrayBuffer()))
      .digest("hex");
    const checksums = join(releases, "SHA256SUMS");
    await writeFile(checksums, `${sha256}  ${archiveName}\n`);
    releaseAssets.set(releaseTag, { archive, checksums });
  }
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      for (const [releaseTag, assets] of releaseAssets) {
        if (path === `/${releaseTag}/${assets.archive.split("/").at(-1)!}`)
          return new Response(Bun.file(assets.archive));
        if (path === `/${releaseTag}/SHA256SUMS`) return new Response(Bun.file(assets.checksums));
      }
      if (path === "/api/releases/latest")
        return Response.json({
          tag_name: options.latestTag ?? `v${latestVersion}`,
          prerelease: false,
          draft: false,
        });
      return new Response("missing", { status: 404 });
    },
  });
}

async function runInstaller(
  root: string,
  releaseBase: string,
  arguments_: readonly string[] = ["--version", version],
  platform: InstallerPlatform = "darwin-arm64",
  environment: Readonly<Record<string, string>> = {},
  useSystemUname = false,
) {
  let path = process.env.PATH ?? "";
  if (!useSystemUname) {
    const fakeBin = join(root, "fake-bin");
    await mkdir(fakeBin, { recursive: true });
    const uname = join(fakeBin, "uname");
    const { unameS, unameM } = platforms[platform];
    await writeFile(
      uname,
      `#!/bin/sh\ncase "$1" in\n  -s) echo ${unameS} ;;\n  -m) echo ${unameM} ;;\nesac\n`,
    );
    await chmod(uname, 0o755);
    path = `${fakeBin}:${path}`;
  }
  const child = Bun.spawn(["sh", join(repositoryRoot, "install.sh"), ...arguments_], {
    cwd: root,
    env: {
      HOME: root,
      PATH: path,
      LORELUM_INSTALL_RELEASE_BASE_URL: releaseBase,
      LORELUM_INSTALL_RELEASE_API_BASE_URL: `${releaseBase}/api/releases`,
      LORELUM_INSTALL_ROOT: join(root, "share"),
      LORELUM_INSTALL_BIN_DIR: join(root, "bin"),
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}
