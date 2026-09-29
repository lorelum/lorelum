import { lstat, readFile, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep, win32 } from "node:path";

export interface ManagedInstall {
  readonly entry: string;
  readonly executable: string;
  readonly installer: string;
}

/** Matches the default layouts written by install.sh and install.ps1. */
export async function findManagedInstall(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly home?: string;
    readonly localAppData?: string;
    readonly executable?: string;
  } = {},
): Promise<ManagedInstall | undefined> {
  const platform = options.platform ?? process.platform;
  const executable = resolve(options.executable ?? process.execPath);
  if (platform === "win32") {
    const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
    if (!localAppData) return undefined;
    const root = win32.resolve(localAppData, "Lorelum");
    const entry = win32.join(root, "bin", "lore.cmd");
    try {
      if (!(await lstat(entry)).isFile()) return undefined;
      const shim = await readFile(entry, "utf8");
      const match = /^@echo off\r?\n"([^"\r\n]+)" %\*\r?\n$/.exec(shim);
      if (!match) return undefined;
      const target = match[1]!;
      const versions = win32.join(root, "versions") + "\\";
      if (!target.toLowerCase().startsWith(versions.toLowerCase())) return undefined;
      const release = target.slice(versions.length);
      if (!/^[^\\/:*?<>|]+\\lore\.exe$/i.test(release)) return undefined;
      if ((await realpath(target)).toLowerCase() !== (await realpath(executable)).toLowerCase())
        return undefined;
      return {
        entry,
        executable: target,
        installer: win32.join(win32.dirname(target), "install.ps1"),
      };
    } catch {
      return undefined;
    }
  }
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const home = options.home ?? process.env.HOME ?? homedir();
  const root = resolve(home, ".local", "share", "lorelum");
  const entry = resolve(home, ".local", "bin", "lore");
  try {
    if (!(await lstat(entry)).isSymbolicLink()) return undefined;
    const target = await readlink(entry);
    const versions = join(root, "versions") + sep;
    if (!target.startsWith(versions)) return undefined;
    const release = target.slice(versions.length);
    if (!/^[^/]+\/lore$/.test(release)) return undefined;
    if ((await lstat(target)).isSymbolicLink()) return undefined;
    if ((await realpath(target)) !== (await realpath(executable))) return undefined;
    const canonicalVersions = join(await realpath(root), "versions");
    if ((await realpath(join(root, "versions"))) !== canonicalVersions) return undefined;
    const directory = resolve(target, "..");
    if ((await realpath(directory)) !== join(canonicalVersions, release.slice(0, -"/lore".length)))
      return undefined;
    return { entry, executable: target, installer: join(directory, "install.sh") };
  } catch {
    return undefined;
  }
}

export async function installerAvailable(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function installerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.startsWith("LORELUM_INSTALL_")),
  );
}

export class InstallerFailure extends Error {
  constructor(readonly reason: "backend" | "download" | "archive" | "conflict" | "unknown") {
    super("The bundled installer failed.");
  }
}

function installerFailureReason(output: string): InstallerFailure["reason"] {
  if (/cannot safely stop.*Backend/i.test(output)) return "backend";
  if (/checksum|SHA256SUMS|archive (?:cannot|contains|extraction|package)/i.test(output))
    return "archive";
  if (/existing version differs|existing version path/i.test(output)) return "conflict";
  if (/cannot download|download failed|remote server returned an error/i.test(output))
    return "download";
  return "unknown";
}

export async function runInstaller(
  install: ManagedInstall,
  version: string,
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const command =
    platform === "win32"
      ? ["powershell.exe", "-NoProfile", "-File", install.installer, "-Version", version]
      : ["/bin/sh", install.installer, "--version", version];
  const child = Bun.spawn(command, {
    env: installerEnvironment(environment),
    stdout: "ignore",
    stderr: "pipe",
  });
  const diagnosticPromise = (async () => {
    const reader = child.stderr.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let diagnostic = "";
    const consume = (line: string) => {
      if (
        /^lore install: downloading archive: \d+\.\d(?: \/ \d+\.\d MiB \(\d{1,3}%\)| MiB) at \d+\.\d MiB\/s$/.test(
          line,
        ) ||
        /^lore install: downloaded archive: \d+\.\d MiB$/.test(line)
      ) {
        process.stderr.write(`${line}\n`);
      } else {
        diagnostic = (diagnostic + line + "\n").slice(-65536);
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (pending.length > 65536) pending = pending.slice(-65536);
      if (done) break;
    }
    if (pending) consume(pending);
    return diagnostic;
  })();
  const [diagnostic, exit] = await Promise.all([diagnosticPromise, child.exited]);
  if (exit !== 0) throw new InstallerFailure(installerFailureReason(diagnostic));
  return true;
}

export async function readEntryVersion(install: ManagedInstall): Promise<string | undefined> {
  // Spawn the entry directly: Bun quotes each argument itself, so routing a
  // Windows shim through a hand-built "cmd.exe /c ..." command string breaks
  // that quoting (embedded quotes arrive escaped, spaced paths split), while
  // Bun's own .cmd wrapping handles both. POSIX entries are plain executables.
  try {
    const child = Bun.spawn([install.entry, "--version"], { stdout: "pipe", stderr: "ignore" });
    const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return exit === 0 ? /^Lorelum (\S+) \(protocol \d+\)\s*$/.exec(output)?.[1] : undefined;
  } catch {
    return undefined;
  }
}
