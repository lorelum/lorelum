import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import config from "../../native/embedding/build-config.json";
import { ensurePinnedDownload } from "./download";

export function nativeBuildWorktreeDirectory(repositoryRoot: string): string {
  return join(repositoryRoot, ".cache", "native-build");
}

export function patchedLlamaSourceDirectory(repositoryRoot: string): string {
  return join(nativeBuildWorktreeDirectory(repositoryRoot), "source");
}

/** A reviewed patch snapshot: verification and application always use the same bytes. */
export class VerifiedNativePatch {
  private constructor(
    readonly repositoryRoot: string,
    private readonly contents: Buffer,
  ) {}

  static read(repositoryRoot: string): VerifiedNativePatch {
    const patchPath = join(repositoryRoot, "native", "embedding", config.patch.path);
    const contents = readFileSync(patchPath);
    if (createHash("sha256").update(contents).digest("hex") !== config.patch.sha256)
      throw new Error(`patch digest does not match ${config.patch.path}`);
    return new VerifiedNativePatch(repositoryRoot, contents);
  }

  apply(sourceRoot: string): void {
    if (process.platform === "win32") {
      // Windows has no `patch`; git apply consumes the same verified snapshot.
      const ceiling = { GIT_CEILING_DIRECTORIES: this.repositoryRoot };
      run(["git", "apply", "--check", "-"], sourceRoot, ceiling, this.contents);
      run(["git", "apply", "-"], sourceRoot, ceiling, this.contents);
    } else {
      run(["patch", "--dry-run", "--batch", "-p1"], sourceRoot, undefined, this.contents);
      run(["patch", "--batch", "-p1"], sourceRoot, undefined, this.contents);
    }
  }
}

/** Materialize the pinned and patched llama.cpp tree for a native build or liveness harness. */
export async function materializePatchedLlamaSource(patch: VerifiedNativePatch): Promise<string> {
  const { repositoryRoot } = patch;
  const worktreeBuildRoot = nativeBuildWorktreeDirectory(repositoryRoot);
  const sourceArchive = join(worktreeBuildRoot, `llama.cpp-${config.source.commit}.tar.gz`);
  const sourceRoot = patchedLlamaSourceDirectory(repositoryRoot);
  mkdirSync(worktreeBuildRoot, { recursive: true });
  await ensurePinnedDownload({
    url: config.source.archiveUrl,
    destination: sourceArchive,
    sha256: config.source.archiveSha256,
    bytes: config.source.archiveBytes,
  });
  rmSync(sourceRoot, { recursive: true, force: true });
  mkdirSync(sourceRoot, { recursive: true });
  // GNU tar treats "D:\..." as host:path; Windows always extracts through System32 bsdtar.
  const tarExecutable =
    process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  run(
    [tarExecutable, "-xzf", sourceArchive, "-C", sourceRoot, "--strip-components=1"],
    repositoryRoot,
  );
  patch.apply(sourceRoot);
  if (
    !readFileSync(join(sourceRoot, "tools/server/main.cpp"), "utf8").includes(
      "start_parent_liveness_watcher",
    )
  ) {
    throw new Error("parent-liveness patch did not modify tools/server/main.cpp");
  }
  return sourceRoot;
}

function run(
  command: readonly string[],
  cwd: string,
  extraEnvironment?: Readonly<Record<string, string>>,
  input?: Uint8Array,
): void {
  const result = Bun.spawnSync([...command], {
    cwd,
    ...(extraEnvironment === undefined ? {} : { env: { ...process.env, ...extraEnvironment } }),
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (${result.exitCode}): ${command.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
}
