import { parseFrontmatter, parseYamlDocument, type UnvalidatedPackInput } from "@lorelum/format";
import { basename, join, relative, sep } from "node:path";

import {
  PackLoadError,
  type PackFileMetadata,
  type PackFileSystem,
  type PackLoader,
} from "./types.js";

export const v1PackInputLimits = {
  maxDecisionBytes: 256 * 1024,
  maxInputFiles: 128,
  maxPackBytes: 64 * 1024,
  maxPracticeBytes: 512 * 1024,
  maxPracticeBytesTotal: 4 * 1024 * 1024,
} as const;

const { maxDecisionBytes, maxInputFiles, maxPackBytes, maxPracticeBytes, maxPracticeBytesTotal } =
  v1PackInputLimits;

/**
 * Loads the v1 directory layout described by ADR 0006. The loader only reads
 * explicitly named input files and delegates all semantic validation to format.
 * Its stable-identity checks are defense in depth under ADR 0006's trusted-local
 * threat model, not atomic isolation from hostile concurrent directory mutation.
 */
export function createPackLoader(fileSystem: PackFileSystem): PackLoader {
  return { load: (packPath) => loadPack(fileSystem, packPath) };
}

async function loadPack(
  fileSystem: PackFileSystem,
  packPath: string,
): Promise<UnvalidatedPackInput> {
  const root = packPath;
  const rootDirectory = stableDirectory(
    root,
    await assertDirectory(fileSystem, root, "pack.path_invalid"),
  );

  const pack = await readYamlFile(fileSystem, root, "pack.yaml", maxPackBytes, [rootDirectory]);
  const decisionsPath = join(root, "decisions.yaml");
  const optionalDecisions = await readOptionalYamlFile(
    fileSystem,
    decisionsPath,
    maxDecisionBytes,
    [rootDirectory],
  );
  const practices = await loadPractices(
    fileSystem,
    root,
    rootDirectory,
    optionalDecisions !== undefined,
  );

  return {
    pack,
    practices,
    decisions: optionalDecisions === undefined ? [] : optionalDecisions,
  };
}

async function loadPractices(
  fileSystem: PackFileSystem,
  root: string,
  rootDirectory: StableDirectory,
  hasDecisions: boolean,
): Promise<unknown[]> {
  const directory = join(root, "practices");
  await assertStableDirectories(fileSystem, [rootDirectory]);
  const metadata = await lstat(fileSystem, directory);
  await assertStableDirectories(fileSystem, [rootDirectory]);
  if (metadata.kind === "missing") return [];
  if (metadata.kind !== "directory") throw unreadable();
  const practicesDirectory = stableDirectory(directory, metadata);

  const directories = [rootDirectory, practicesDirectory];
  const entries = await readDirectory(fileSystem, directory, directories);
  const candidates = entries.filter((entry) => entry.name.endsWith(".md"));
  if (candidates.some((entry) => entry.kind !== "file")) throw unreadable();
  const markdown = candidates;
  if (markdown.length + 1 + Number(hasDecisions) > maxInputFiles) throw unreadable();

  let totalBytes = 0;
  const contents: string[] = [];
  for (const entry of markdown.sort((left, right) => compareEntryNames(left.name, right.name))) {
    // Read sequentially so the aggregate limit is enforced before the next input opens.
    // eslint-disable-next-line no-await-in-loop
    const content = await readFile(
      fileSystem,
      childPath(root, directory, entry.name),
      maxPracticeBytes,
      directories,
    );
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > maxPracticeBytesTotal) throw unreadable();
    contents.push(content);
  }
  return contents.map(parsePractice);
}

function compareEntryNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function readYamlFile(
  fileSystem: PackFileSystem,
  root: string,
  name: "pack.yaml",
  maxBytes: number,
  directories: readonly StableDirectory[],
): Promise<unknown> {
  const path = join(root, name);
  const content = await readFile(fileSystem, path, maxBytes, directories);
  return parseYaml(content);
}

async function readOptionalYamlFile(
  fileSystem: PackFileSystem,
  path: string,
  maxBytes: number,
  directories: readonly StableDirectory[],
): Promise<unknown | undefined> {
  await assertStableDirectories(fileSystem, directories);
  const metadata = await lstat(fileSystem, path);
  await assertStableDirectories(fileSystem, directories);
  if (metadata.kind === "missing") return undefined;
  return parseYaml(await readFile(fileSystem, path, maxBytes, directories));
}

async function assertDirectory(
  fileSystem: PackFileSystem,
  path: string,
  code: "pack.path_invalid",
): Promise<PackFileMetadata> {
  const metadata = await lstat(fileSystem, path);
  if (metadata.kind !== "directory") {
    throw new PackLoadError(code, "The pack path must be a readable directory.");
  }
  return metadata;
}

async function readFile(
  fileSystem: PackFileSystem,
  path: string,
  maxBytes: number,
  directories: readonly StableDirectory[],
): Promise<string> {
  await assertStableDirectories(fileSystem, directories);
  try {
    const content = await fileSystem.readRegularFile(path, maxBytes);
    await assertStableDirectories(fileSystem, directories);
    return content;
  } catch {
    throw unreadable();
  }
}

async function lstat(fileSystem: PackFileSystem, path: string): Promise<PackFileMetadata> {
  try {
    return await fileSystem.lstat(path);
  } catch {
    throw unreadable();
  }
}

async function readDirectory(
  fileSystem: PackFileSystem,
  path: string,
  directories: readonly StableDirectory[],
) {
  await assertStableDirectories(fileSystem, directories);
  try {
    const entries = await fileSystem.readDirectory(path);
    await assertStableDirectories(fileSystem, directories);
    return entries;
  } catch {
    throw unreadable();
  }
}

interface StableDirectory {
  identity: string;
  path: string;
}

function stableDirectory(path: string, metadata: PackFileMetadata): StableDirectory {
  if (metadata.identity === undefined) throw unreadable();
  return { identity: metadata.identity, path };
}

async function assertStableDirectories(
  fileSystem: PackFileSystem,
  directories: readonly StableDirectory[],
): Promise<void> {
  await Promise.all(
    directories.map(async (directory) => {
      const metadata = await lstat(fileSystem, directory.path);
      if (metadata.kind !== "directory" || metadata.identity !== directory.identity)
        throw unreadable();
    }),
  );
}

function childPath(root: string, directory: string, name: string): string {
  if (basename(name) !== name) throw unreadable();
  const path = join(directory, name);
  const pathToRoot = relative(root, path);
  if (pathToRoot === "" || pathToRoot.startsWith(`..${sep}`) || pathToRoot === "..")
    throw unreadable();
  return path;
}

function parseYaml(content: string): unknown {
  try {
    return parseYamlDocument(content);
  } catch {
    throw new PackLoadError("pack.parse_error", "A pack document could not be parsed.");
  }
}

function parsePractice(content: string): unknown {
  try {
    const frontmatter = parseFrontmatter(content);
    return { ...frontmatter.data, body: frontmatter.content };
  } catch {
    throw new PackLoadError("pack.parse_error", "A pack document could not be parsed.");
  }
}

function unreadable(): PackLoadError {
  return new PackLoadError("pack.unreadable", "A pack input could not be read.");
}
