import { expect, spyOn, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findManagedInstall,
  InstallerFailure,
  installerEnvironment,
  readEntryVersion,
  runInstaller,
} from "./managed-install.js";

test.skipIf(process.platform === "win32")(
  "recognizes only a default installer symlink targeting the running binary",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lore-update-entry-"));
    try {
      const directory = join(home, ".local/share/lorelum/versions/0.1.0-alpha.5");
      const bin = join(home, ".local/bin");
      await mkdir(directory, { recursive: true });
      await mkdir(bin, { recursive: true });
      const binary = join(directory, "lore");
      await writeFile(binary, "binary");
      await chmod(binary, 0o755);
      await symlink(binary, join(bin, "lore"));
      expect(
        await findManagedInstall({ platform: "darwin", home, executable: binary }),
      ).toMatchObject({ executable: binary, installer: join(directory, "install.sh") });
      expect(
        await findManagedInstall({ platform: "darwin", home, executable: join(home, "other") }),
      ).toBeUndefined();
      expect(await readlink(join(bin, "lore"))).toBe(binary);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== "win32")(
  "reads the default entry version through the shim on Windows",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-update-entry-win-"));
    try {
      // A spaced directory exercises the spawn quoting that a cmd.exe
      // intermediary would break; the shim mirrors install.ps1's format.
      const entry = join(root, "bin with space", "lore.cmd");
      await mkdir(dirname(entry), { recursive: true });
      await writeFile(entry, "@echo off\r\n@echo Lorelum 0.1.0-alpha.5 (protocol 2)\r\n");
      expect(await readEntryVersion({ entry, executable: "unused", installer: "unused" })).toBe(
        "0.1.0-alpha.5",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "turns installer diagnostics into safe failure categories without echoing raw output",
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "lore-update-error-"));
    try {
      const installer = join(profile, "install.sh");
      await writeFile(
        installer,
        "#!/bin/sh\necho 'lore install: cannot safely stop the existing Lorelum Backend; proxy password=secret' >&2\nexit 1\n",
      );
      const result = runInstaller(
        { entry: "unused", executable: "unused", installer },
        "0.1.0",
        "darwin",
      );
      expect(result).rejects.toMatchObject({
        reason: "backend",
        message: "The bundled installer failed.",
      });
      expect(InstallerFailure).toBeDefined();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  },
);

test("does not pass installer destination or source overrides to its child", () => {
  expect(
    installerEnvironment({
      HOME: "/isolated",
      HTTPS_PROXY: "proxy",
      LORELUM_INSTALL_ROOT: "/other",
      LORELUM_INSTALL_RELEASE_BASE_URL: "untrusted",
    }),
  ).toEqual({
    HOME: "/isolated",
    HTTPS_PROXY: "proxy",
  });
});

test.skipIf(process.platform === "win32")(
  "forwards only installer archive progress, not arbitrary child diagnostics",
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "lore-update-progress-"));
    const lines: string[] = [];
    const write = spyOn(process.stderr, "write").mockImplementation((value) => {
      lines.push(String(value));
      return true;
    });
    try {
      const installer = join(profile, "install.sh");
      await writeFile(
        installer,
        "#!/bin/sh\necho 'lore install: downloading archive: 1.5 / 8.0 MiB (18%) at 2.0 MiB/s' >&2\necho 'lore install: downloading archive: 2.0 MiB at 0.5 MiB/s' >&2\necho 'lore install: downloaded archive: 8.0 MiB' >&2\necho 'proxy password=secret' >&2\n",
      );
      await runInstaller({ entry: "unused", executable: "unused", installer }, "0.1.0", "darwin");
      expect(lines).toEqual([
        "lore install: downloading archive: 1.5 / 8.0 MiB (18%) at 2.0 MiB/s\n",
        "lore install: downloading archive: 2.0 MiB at 0.5 MiB/s\n",
        "lore install: downloaded archive: 8.0 MiB\n",
      ]);
    } finally {
      write.mockRestore();
      await rm(profile, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "calls the bundled installer with an exact version and checks the default entry",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lore-update-script-"));
    try {
      const binary = join(home, "lore");
      const entry = join(home, "bin", "lore");
      const installer = join(home, "install.sh");
      await mkdir(join(home, "bin"));
      await writeFile(binary, "#!/bin/sh\nprintf 'Lorelum 0.1.0-alpha.5 (protocol 2)\\n'\n");
      await chmod(binary, 0o755);
      await symlink(binary, entry);
      await writeFile(
        installer,
        '#!/bin/sh\nprintf \'%s\\n\' "$1 $2 ${LORELUM_INSTALL_ROOT-unset}" > "$HOME/invocation"\n',
      );
      expect(
        await runInstaller({ entry, executable: binary, installer }, "0.1.0-alpha.5", "darwin", {
          ...process.env,
          HOME: home,
          LORELUM_INSTALL_ROOT: "/not-default",
        }),
      ).toBe(true);
      // The test uses a disposable script and checks its exact arguments; the
      // official installer archive/Backend behavior has separate integration tests.
      expect(await readFile(join(home, "invocation"), "utf8")).toBe(
        "--version 0.1.0-alpha.5 unset\n",
      );
      expect(await readEntryVersion({ entry, executable: binary, installer })).toBe(
        "0.1.0-alpha.5",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
