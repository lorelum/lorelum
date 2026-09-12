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

/** Verify the reviewed patch before it affects a cache key or native source tree. */
export function assertNativePatchDigest(repositoryRoot: string): void {
  const patchPath = join(repositoryRoot, "native", "embedding", config.patch.path);
  if (sha256File(patchPath) !== config.patch.sha256)
    throw new Error(`patch digest does not match ${config.patch.path}`);
}

/** Materialize the pinned and patched llama.cpp tree for a native build or liveness harness. */
export async function materializePatchedLlamaSource(repositoryRoot: string): Promise<string> {
  assertNativePatchDigest(repositoryRoot);
  const worktreeBuildRoot = nativeBuildWorktreeDirectory(repositoryRoot);
  const sourceArchive = join(worktreeBuildRoot, `llama.cpp-${config.source.commit}.tar.gz`);
  const sourceRoot = patchedLlamaSourceDirectory(repositoryRoot);
  const patchPath = join(repositoryRoot, "native", "embedding", config.patch.path);
  mkdirSync(worktreeBuildRoot, { recursive: true });
  await ensurePinnedDownload({
    url: config.source.archiveUrl,
    destination: sourceArchive,
    sha256: config.source.archiveSha256,
    bytes: config.source.archiveBytes,
  });
  rmSync(sourceRoot, { recursive: true, force: true });
  mkdirSync(sourceRoot, { recursive: true });
  run(["tar", "-xzf", sourceArchive, "-C", sourceRoot, "--strip-components=1"], repositoryRoot);
  run(["patch", "--dry-run", "--batch", "-p1", "-i", patchPath], sourceRoot);
  run(["patch", "--batch", "-p1", "-i", patchPath], sourceRoot);
  if (
    !readFileSync(join(sourceRoot, "tools/server/main.cpp"), "utf8").includes(
      "start_parent_liveness_watcher",
    )
  ) {
    throw new Error("parent-liveness patch did not modify tools/server/main.cpp");
  }
  return sourceRoot;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command: readonly string[], cwd: string): void {
  const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (${result.exitCode}): ${command.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
}
