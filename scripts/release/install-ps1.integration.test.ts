/* eslint-disable no-await-in-loop -- Release fixtures are assembled deterministically before serving assets. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const windowsOnly = process.platform === "win32";
const version = "0.1.0";
const upgradeVersion = "0.1.1";
const target = "win32-x64";
const repositoryRoot = join(import.meta.dir, "..", "..");
const installer = join(repositoryRoot, "install.ps1");
// The stop fixture is a compiled Bun runtime (~86MB), and Windows real-time antivirus
// rescans it on every spawn, so one backend stop can take seconds on its own.
const stopFixtureTimeout = 120_000;

interface InstallerRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

test.skipIf(!windowsOnly)(
  "windows installer verifies, extracts, and installs one platform package",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-"));
    const server = await createReleaseServer(root);
    try {
      const result = await runInstaller(root, server.url.origin);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const shim = (await readFile(join(root, "bin", "lore.cmd"), "utf8")).trim();
      expect(shim).toContain(`"${join(root, "share", "versions", version, "lore.exe")}"`);
      expect(await readFile(join(root, "share", "versions", version, "LICENSE"), "utf8")).toBe(
        "Apache-2.0 fixture\n",
      );
      expect(await readFile(join(root, "share", "versions", version, "lore.exe"), "utf8")).toBe(
        "cli fixture\n",
      );
      expect(result.stdout).toContain(`Installed lore ${version}`);
      expect(result.stdout).toContain(`Added ${join(root, "bin")} to the process PATH.`);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!windowsOnly)(
  "windows installer resolves the latest stable release when no version is supplied",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-latest-"));
    const server = await createReleaseServer(root);
    try {
      const result = await runInstaller(root, server.url.origin, []);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(await Bun.file(join(root, "share", "versions", version, "lore.exe")).exists()).toBe(
        true,
      );
      expect(result.stdout).toContain(`Installed lore ${version}`);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!windowsOnly)(
  "windows installer rejects a latest-release tag that is not semantic versioning",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-invalid-"));
    const server = await createReleaseServer(root, { latestTag: "release-candidate" });
    try {
      const result = await runInstaller(root, server.url.origin, []);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cannot resolve the latest stable release");
      expect(await Bun.file(join(root, "share", "versions", version, "lore.exe")).exists()).toBe(
        false,
      );
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(!windowsOnly)("windows installer leaves an unmanaged command untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-win-conflict-"));
  const server = await createReleaseServer(root);
  try {
    await mkdir(join(root, "bin"), { recursive: true });
    const command = join(root, "bin", "lore.cmd");
    await writeFile(command, "foreign\r\n");
    const result = await runInstaller(root, server.url.origin);
    expect(result.exitCode).toBe(1);
    expect(await readFile(command, "utf8")).toBe("foreign\r\n");
    expect(await Bun.file(join(root, "share", "versions", version, "lore.exe")).exists()).toBe(
      false,
    );
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!windowsOnly)(
  "windows installer stops the managed old release before activating an upgrade",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-upgrade-"));
    const fixture = await createStopFixture(root);
    const server = await createReleaseServer(root, {
      versions: [version, upgradeVersion],
      stopFixture: fixture,
    });
    try {
      const command = join(root, "bin", "lore.cmd");
      const stopLog = join(root, "backend-stop.log");
      const environment = { LORELUM_INSTALL_TEST_STOP_LOG: stopLog };
      expect(
        (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
      ).toBe(0);

      const result = await runInstaller(
        root,
        server.url.origin,
        ["-Version", upgradeVersion],
        environment,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Stopping the existing Lorelum Backend before upgrading.");
      expect(await readFile(command, "utf8")).toContain(
        `"${join(root, "share", "versions", upgradeVersion, "lore.exe")}"`,
      );
      expect(await readFile(stopLog, "utf8")).toBe("old\n");
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  stopFixtureTimeout,
);

test.skipIf(!windowsOnly)(
  "windows installer falls back to the verified candidate when the old release cannot stop",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-fallback-"));
    const fixture = await createStopFixture(root);
    const server = await createReleaseServer(root, {
      versions: [version, upgradeVersion],
      stopFixture: fixture,
    });
    try {
      const command = join(root, "bin", "lore.cmd");
      const stopLog = join(root, "backend-stop.log");
      const environment = {
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
        LORELUM_INSTALL_TEST_OLD_EXIT: "1",
        LORELUM_INSTALL_TEST_CANDIDATE_EXIT: "0",
      };
      expect(
        (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
      ).toBe(0);

      const result = await runInstaller(
        root,
        server.url.origin,
        ["-Version", upgradeVersion],
        environment,
      );
      expect(result.exitCode).toBe(0);
      expect(await readFile(command, "utf8")).toContain(
        `"${join(root, "share", "versions", upgradeVersion, "lore.exe")}"`,
      );
      expect(await readFile(stopLog, "utf8")).toBe("old\ncandidate\n");
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  stopFixtureTimeout,
);

test.skipIf(!windowsOnly)(
  "windows installer keeps the old entry when neither release can stop the Backend",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-stop-failure-"));
    const fixture = await createStopFixture(root);
    const server = await createReleaseServer(root, {
      versions: [version, upgradeVersion],
      stopFixture: fixture,
    });
    try {
      const command = join(root, "bin", "lore.cmd");
      const stopLog = join(root, "backend-stop.log");
      const environment = {
        LORELUM_INSTALL_TEST_STOP_LOG: stopLog,
        LORELUM_INSTALL_TEST_OLD_EXIT: "1",
        LORELUM_INSTALL_TEST_CANDIDATE_EXIT: "1",
      };
      expect(
        (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
      ).toBe(0);
      const oldShim = await readFile(command, "utf8");
      const oldExecutable = await readFile(join(root, "share", "versions", version, "lore.exe"));

      const result = await runInstaller(
        root,
        server.url.origin,
        ["-Version", upgradeVersion],
        environment,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cannot safely stop the existing Lorelum Backend");
      expect(result.stderr).toContain("backend stop");
      expect(result.stderr).toContain("backend.incompatible");
      expect(await readFile(command, "utf8")).toBe(oldShim);
      expect(await readFile(join(root, "share", "versions", version, "lore.exe"))).toEqual(
        oldExecutable,
      );
      expect(await readFile(stopLog, "utf8")).toBe("old\ncandidate\n");
      await expect(
        Bun.file(join(root, "share", "versions", upgradeVersion, "lore.exe")).exists(),
      ).resolves.toBe(false);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  stopFixtureTimeout,
);

test.skipIf(!windowsOnly)(
  "windows installer validates a target-version conflict before it stops the old Backend",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-destination-conflict-"));
    const fixture = await createStopFixture(root);
    const server = await createReleaseServer(root, {
      versions: [version, upgradeVersion],
      stopFixture: fixture,
    });
    try {
      const command = join(root, "bin", "lore.cmd");
      const stopLog = join(root, "backend-stop.log");
      const environment = { LORELUM_INSTALL_TEST_STOP_LOG: stopLog };
      expect(
        (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
      ).toBe(0);
      await mkdir(join(root, "share", "versions", upgradeVersion), { recursive: true });
      await writeFile(
        join(root, "share", "versions", upgradeVersion, "lore.exe"),
        "different release\n",
      );

      const result = await runInstaller(
        root,
        server.url.origin,
        ["-Version", upgradeVersion],
        environment,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("existing version differs from the verified archive");
      expect(await readFile(command, "utf8")).toContain(
        `"${join(root, "share", "versions", version, "lore.exe")}"`,
      );
      await expect(Bun.file(stopLog).exists()).resolves.toBe(false);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  stopFixtureTimeout,
);

test.skipIf(!windowsOnly)("windows same-release reinstall does not stop the Backend", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-win-same-version-"));
  const fixture = await createStopFixture(root);
  const server = await createReleaseServer(root, { stopFixture: fixture });
  try {
    const stopLog = join(root, "backend-stop.log");
    const environment = { LORELUM_INSTALL_TEST_STOP_LOG: stopLog };
    expect(
      (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
    ).toBe(0);
    expect(
      (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
    ).toBe(0);
    await expect(Bun.file(stopLog).exists()).resolves.toBe(false);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, stopFixtureTimeout);

test.skipIf(!windowsOnly)("windows installer never executes a malformed managed shim", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-install-win-malformed-shim-"));
  const fixture = await createStopFixture(root);
  const server = await createReleaseServer(root, {
    versions: [version, upgradeVersion],
    stopFixture: fixture,
  });
  try {
    const command = join(root, "bin", "lore.cmd");
    const stopLog = join(root, "backend-stop.log");
    const marker = join(root, "malicious-shim-ran.txt");
    const environment = { LORELUM_INSTALL_TEST_STOP_LOG: stopLog };
    expect(
      (await runInstaller(root, server.url.origin, ["-Version", version], environment)).exitCode,
    ).toBe(0);
    await writeFile(
      command,
      `@echo off\r\n"${join(root, "share", "versions", version, "lore.exe")}" %*\r\necho ran > "${marker}"\r\n`,
    );

    const result = await runInstaller(
      root,
      server.url.origin,
      ["-Version", upgradeVersion],
      environment,
    );
    expect(result.exitCode).toBe(0);
    expect(await readFile(stopLog, "utf8")).toBe("candidate\n");
    await expect(Bun.file(marker).exists()).resolves.toBe(false);
    expect(await readFile(command, "utf8")).toContain(
      `"${join(root, "share", "versions", upgradeVersion, "lore.exe")}"`,
    );
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, stopFixtureTimeout);

test.skipIf(!windowsOnly)(
  "windows installer throws without terminating an interactive caller",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-install-win-throw-"));
    try {
      await mkdir(join(root, "temp"), { recursive: true });
      const escapedInstaller = installer.replace(/'/g, "''");
      const child = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `try { & '${escapedInstaller}' -Version invalid } catch { Write-Output 'caller-survived' }`,
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            LORELUM_INSTALL_PATH_TARGET: "Process",
            LOCALAPPDATA: join(root, "localappdata"),
            TEMP: join(root, "temp"),
            TMP: join(root, "temp"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const stdout = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(stdout).toContain("caller-survived");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function createReleaseServer(
  root: string,
  options: { latestTag?: string; versions?: readonly string[]; stopFixture?: string } = {},
) {
  const releaseVersions = options.versions ?? [version];
  const releaseAssets = new Map<string, { archive: string; checksums: string }>();
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  for (const releaseVersion of releaseVersions) {
    const releaseTag = `v${releaseVersion}`;
    const currentArchiveName = `lore-${releaseVersion}-${target}.zip`;
    const currentPackageName = currentArchiveName.slice(0, -".zip".length);
    const releases = join(root, "releases", releaseTag);
    const packageDirectory = join(root, currentPackageName);
    await mkdir(join(packageDirectory, "native", target), { recursive: true });
    if (options.stopFixture)
      await copyFile(options.stopFixture, join(packageDirectory, "lore.exe"));
    else await writeFile(join(packageDirectory, "lore.exe"), "cli fixture\n");
    await writeFile(join(packageDirectory, "LICENSE"), "Apache-2.0 fixture\n");
    await writeFile(join(packageDirectory, "THIRD_PARTY_NOTICES.txt"), "notices\n");
    await writeFile(join(packageDirectory, "native", target, "lore-model.exe"), "native\n");
    await writeFile(join(packageDirectory, "native", target, "manifest.json"), "{}\n");
    await chmod(join(packageDirectory, "lore.exe"), 0o755);
    await mkdir(releases, { recursive: true });
    const archive = join(releases, currentArchiveName);
    const archived = Bun.spawnSync([tar, "-C", root, "-a", "-cf", archive, currentPackageName]);
    if (archived.exitCode !== 0) throw new Error("fixture archive creation failed");
    const sha256 = createHash("sha256")
      .update(Buffer.from(await Bun.file(archive).arrayBuffer()))
      .digest("hex");
    const checksums = join(releases, "SHA256SUMS");
    await writeFile(checksums, `${sha256}  ${currentArchiveName}\n`);
    releaseAssets.set(releaseTag, { archive, checksums });
  }
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      for (const [releaseTag, assets] of releaseAssets) {
        if (path === `/${releaseTag}/${assets.archive.split("\\").at(-1)!}`)
          return new Response(Bun.file(assets.archive));
        if (path === `/${releaseTag}/SHA256SUMS`) return new Response(Bun.file(assets.checksums));
      }
      if (path === "/api/releases/latest")
        return Response.json({
          tag_name: options.latestTag ?? `v${releaseVersions[0]!}`,
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
  arguments_: readonly string[] = ["-Version", version],
  environment: Readonly<Record<string, string>> = {},
): Promise<InstallerRun> {
  // PowerShell needs SystemRoot and a writable TEMP even with the overrides below.
  const temporary = join(root, "temp");
  await mkdir(temporary, { recursive: true });
  const child = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      installer,
      ...arguments_,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        LORELUM_INSTALL_RELEASE_BASE_URL: releaseBase,
        LORELUM_INSTALL_RELEASE_API_BASE_URL: `${releaseBase}/api/releases`,
        LORELUM_INSTALL_ROOT: join(root, "share"),
        LORELUM_INSTALL_BIN_DIR: join(root, "bin"),
        LORELUM_INSTALL_PATH_TARGET: "Process",
        LOCALAPPDATA: join(root, "localappdata"),
        TEMP: temporary,
        TMP: temporary,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode: exitCode ?? 1 };
}

async function createStopFixture(root: string): Promise<string> {
  const source = join(root, "backend-stop-fixture.ts");
  const bundle = join(root, "backend-stop-fixture.bundle.js");
  const output = join(root, "backend-stop-fixture");
  await writeFile(
    source,
    [
      'import { appendFileSync } from "node:fs";',
      'if (process.argv[2] === "backend" && process.argv[3] === "stop") {',
      '  const role = /[\\\\/]versions[\\\\/][^\\\\/]+[\\\\/]lore\\.exe$/i.test(process.execPath) ? "old" : "candidate";',
      "  if (process.env.LORELUM_INSTALL_TEST_STOP_LOG) appendFileSync(process.env.LORELUM_INSTALL_TEST_STOP_LOG, `${role}\\n`);",
      '  const value = role === "old" ? process.env.LORELUM_INSTALL_TEST_OLD_EXIT : process.env.LORELUM_INSTALL_TEST_CANDIDATE_EXIT;',
      '  if (value === "1") console.error("backend.incompatible");',
      '  process.exit(value === "1" ? 1 : 0);',
      "}",
      "process.exit(0);",
    ].join("\n"),
  );
  const bundled = await Bun.build({ entrypoints: [source], target: "bun", format: "esm" });
  if (!bundled.success) throw new Error("fixture bundle failed");
  const entry = bundled.outputs.find((artifact) => artifact.kind === "entry-point");
  if (entry === undefined) throw new Error("fixture bundle has no entry point");
  await Bun.write(bundle, entry);
  const compiled = Bun.spawnSync([
    process.execPath,
    "build",
    "--compile",
    "--target=bun-windows-x64",
    bundle,
    "--outfile",
    output,
  ]);
  if (compiled.exitCode !== 0) throw new Error("fixture executable compilation failed");
  const executable = `${output}.exe`;
  if (!(await Bun.file(executable).exists())) throw new Error("fixture executable is missing");
  return executable;
}
