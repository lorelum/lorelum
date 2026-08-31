import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { defaultPackDirectoryLimits, isPracticeSourcePath } from "@lorelum/engine";
import type { RegistryRelease } from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";

const GIT_TIMEOUT_MS = 60_000;
const MAX_SOURCE_TREE_ENTRIES = 2_048;
const MAX_SOURCE_TREE_LISTING_BYTES = 1024 * 1024;
const GIT_ENVIRONMENT = Object.freeze({
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  TMPDIR: process.env.TMPDIR,
  GIT_ASKPASS: "",
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
});

interface SourceBlob {
  readonly objectId: string;
  readonly relativePath: string;
}

interface GitCommandOptions {
  readonly input?: Uint8Array;
  readonly outputLimit?: number;
}

export type MaterializeGitRunner = (
  arguments_: readonly string[],
  options?: GitCommandOptions,
) => Promise<Uint8Array>;

function sourceUnavailable(): CliError {
  return new CliError(cliErrorCodes.sourceUnavailable, "The Pack source is unavailable.");
}

function sourceInvalid(): CliError {
  return new CliError(cliErrorCodes.sourceInvalid, "The Pack source is invalid.");
}

export interface MaterializedPackSource {
  readonly directory: string;
  readonly resolvedRef: string;
  readonly resolvedCommit: string;
  cleanup(): Promise<void>;
}

async function runGit(
  arguments_: readonly string[],
  options: GitCommandOptions = {},
): Promise<Uint8Array> {
  const { input, outputLimit } = options;
  let subprocess: ReturnType<typeof Bun.spawn>;
  try {
    subprocess = Bun.spawn(["git", ...arguments_], {
      env: GIT_ENVIRONMENT,
      ...(input === undefined ? {} : { stdin: input }),
      stderr: "ignore",
      stdout: outputLimit === undefined ? "ignore" : "pipe",
    });
  } catch {
    throw sourceUnavailable();
  }
  if (outputLimit !== undefined && !(subprocess.stdout instanceof ReadableStream)) {
    throw sourceUnavailable();
  }
  const timeout = setTimeout(() => subprocess.kill(), GIT_TIMEOUT_MS);
  try {
    let output: Uint8Array | undefined;
    if (outputLimit !== undefined) {
      const reader = (subprocess.stdout as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      /* eslint-disable no-await-in-loop -- a process stream must be consumed serially */
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > outputLimit) {
          await reader.cancel();
          throw sourceInvalid();
        }
        chunks.push(chunk.value);
      }
      /* eslint-enable no-await-in-loop */
      output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    if ((await subprocess.exited) !== 0) throw sourceUnavailable();
    return output ?? new Uint8Array();
  } catch (error) {
    try {
      subprocess.kill();
    } catch {
      // The process already exited; retain the primary typed error.
    }
    await subprocess.exited.catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function cloneRelease(
  ref: string,
  destination: string,
  repository: string,
  git: MaterializeGitRunner,
): Promise<void> {
  await git([
    "-c",
    "advice.detachedHead=false",
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--branch",
    ref,
    "--filter=tree:0",
    "--no-checkout",
    "--",
    repository,
    destination,
  ]);
}

async function readResolvedCommit(
  repositoryRoot: string,
  git: MaterializeGitRunner,
): Promise<string> {
  const output = await git(["-C", repositoryRoot, "rev-parse", "HEAD"], {
    outputLimit: 256,
  });
  const commit = new TextDecoder().decode(output).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw sourceInvalid();
  return commit;
}

function isConsumedPackPath(path: string): boolean {
  return path === "pack.yaml" || path === "decisions.yaml" || isPracticeSourcePath(path);
}

function parseSourceTree(output: Uint8Array, sourcePath: string): SourceBlob[] {
  const entries = new TextDecoder().decode(output).split(String.fromCharCode(0)).filter(Boolean);
  if (entries.length === 0 || entries.length > MAX_SOURCE_TREE_ENTRIES) {
    throw sourceInvalid();
  }

  const prefix = `${sourcePath}/`;
  const blobs: SourceBlob[] = [];
  const relativePaths = new Set<string>();
  let practiceFiles = 0;
  for (const entry of entries) {
    const separator = entry.indexOf("\t");
    if (separator < 0) throw sourceInvalid();
    const header = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40,64})$/.exec(header);
    if (match === null) throw sourceInvalid();
    if (!path.startsWith(prefix)) throw sourceInvalid();
    const relativePath = path.slice(prefix.length);
    if (!isConsumedPackPath(relativePath)) continue;
    if (!["100644", "100755"].includes(match[1]!) || match[2] !== "blob") {
      throw sourceInvalid();
    }
    if (relativePaths.has(relativePath)) throw sourceInvalid();
    relativePaths.add(relativePath);

    if (isPracticeSourcePath(relativePath)) {
      practiceFiles += 1;
      if (practiceFiles > defaultPackDirectoryLimits.maxPracticeFiles) throw sourceInvalid();
    }
    blobs.push({ objectId: match[3]!, relativePath });
  }
  if (!blobs.some((blob) => blob.relativePath === "pack.yaml")) throw sourceInvalid();
  return blobs.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
}

async function inspectSourceTree(
  repositoryRoot: string,
  sourcePath: string,
  git: MaterializeGitRunner,
): Promise<SourceBlob[]> {
  const output = await git(
    [
      "-C",
      repositoryRoot,
      "ls-tree",
      "-r",
      "-z",
      "HEAD",
      "--",
      `${sourcePath}/pack.yaml`,
      `${sourcePath}/decisions.yaml`,
      `${sourcePath}/practices`,
    ],
    { outputLimit: MAX_SOURCE_TREE_LISTING_BYTES },
  );
  return parseSourceTree(output, sourcePath);
}

function encodeObjectIds(objectIds: readonly string[]): Uint8Array {
  return new TextEncoder().encode(`${objectIds.join("\n")}\n`);
}

function findLineFeed(output: Uint8Array, start: number): number {
  for (let index = start; index < output.byteLength; index += 1) {
    if (output[index] === 0x0a) return index;
  }
  return -1;
}

function parseBlobBatch(output: Uint8Array, blobs: readonly SourceBlob[]): Uint8Array[] {
  const contents: Uint8Array[] = [];
  let offset = 0;
  let totalBytes = 0;
  for (const blob of blobs) {
    const headerEnd = findLineFeed(output, offset);
    if (headerEnd < 0) throw sourceInvalid();
    const header = new TextDecoder().decode(output.subarray(offset, headerEnd));
    const match = /^([0-9a-f]{40,64}) blob ([0-9]+)$/.exec(header);
    if (match === null || match[1] !== blob.objectId) throw sourceInvalid();
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength) || byteLength > defaultPackDirectoryLimits.maxFileBytes) {
      throw sourceInvalid();
    }
    const contentsStart = headerEnd + 1;
    const contentsEnd = contentsStart + byteLength;
    if (contentsEnd >= output.byteLength || output[contentsEnd] !== 0x0a) {
      throw sourceInvalid();
    }
    totalBytes += byteLength;
    if (totalBytes > defaultPackDirectoryLimits.maxTotalBytes) throw sourceInvalid();
    contents.push(output.subarray(contentsStart, contentsEnd));
    offset = contentsEnd + 1;
  }
  if (offset !== output.byteLength) throw sourceInvalid();
  return contents;
}

async function readBlobs(
  repositoryRoot: string,
  blobs: readonly SourceBlob[],
  git: MaterializeGitRunner,
): Promise<Uint8Array[]> {
  const batchObjectIds = blobs.map((blob) => blob.objectId);
  const fetchObjectIds = [...new Set(batchObjectIds)];
  await git(
    [
      "-C",
      repositoryRoot,
      "-c",
      "fetch.negotiationAlgorithm=noop",
      "fetch",
      "origin",
      "--no-tags",
      "--no-write-fetch-head",
      "--recurse-submodules=no",
      "--filter=blob:none",
      "--no-auto-gc",
      "--stdin",
    ],
    { input: encodeObjectIds(fetchObjectIds) },
  );
  const output = await git(
    ["-C", repositoryRoot, "cat-file", "--batch=%(objectname) %(objecttype) %(objectsize)"],
    {
      input: encodeObjectIds(batchObjectIds),
      outputLimit: defaultPackDirectoryLimits.maxTotalBytes + blobs.length * 128,
    },
  );
  return parseBlobBatch(output, blobs);
}

async function materializeBlobs(
  repositoryRoot: string,
  blobs: readonly SourceBlob[],
  targetDirectory: string,
  git: MaterializeGitRunner,
): Promise<void> {
  await mkdir(join(targetDirectory, "practices"), { recursive: true });
  const contents = await readBlobs(repositoryRoot, blobs, git);
  for (const [index, blob] of blobs.entries()) {
    const target = join(targetDirectory, ...blob.relativePath.split("/"));
    // eslint-disable-next-line no-await-in-loop -- each validated blob has one deterministic target
    await mkdir(dirname(target), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- writes remain serial with the shared byte budget
    await writeFile(target, contents[index]!, { flag: "wx", mode: 0o600 });
  }
}

/** Materialize only validated Pack blobs; no checkout or Git content filters run. */
export async function materializeRegistryRelease(
  release: RegistryRelease,
  repository: string,
  git: MaterializeGitRunner = runGit,
): Promise<MaterializedPackSource> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lorelum-install-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  const packDirectory = join(temporaryRoot, "pack");
  try {
    await cloneRelease(release.ref, repositoryRoot, repository, git);
    const resolvedCommit = await readResolvedCommit(repositoryRoot, git);
    const blobs = await inspectSourceTree(repositoryRoot, release.path, git);
    await materializeBlobs(repositoryRoot, blobs, packDirectory, git);
    return {
      directory: packDirectory,
      resolvedRef: release.ref,
      resolvedCommit,
      cleanup: () => rm(temporaryRoot, { force: true, recursive: true }),
    };
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
    if (error instanceof CliError) throw error;
    throw sourceInvalid();
  }
}
