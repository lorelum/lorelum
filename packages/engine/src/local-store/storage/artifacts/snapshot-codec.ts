import { lstat, opendir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { parseFrontmatter, parseYaml, type ValidationIssue } from "@lorelum/format";

import { createPackCandidate, type PackCandidate } from "../../model";

import { SnapshotFormatError } from "../errors";

export interface PackDirectoryLimits {
  readonly maxPracticeFiles: number;
  readonly maxEntries: number;
  readonly maxDirectories: number;
  readonly maxDirectoryDepth: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const defaultPackDirectoryLimits: PackDirectoryLimits = Object.freeze({
  maxPracticeFiles: 500,
  maxEntries: 2_048,
  maxDirectories: 256,
  maxDirectoryDepth: 32,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

interface DecodeBudget {
  practiceFiles: number;
  entries: number;
  directories: number;
  totalBytes: number;
}

function relativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

async function discoverPractices(
  directory: string,
  limits: PackDirectoryLimits,
  budget: DecodeBudget,
  depth = 0,
): Promise<string[]> {
  if (depth > limits.maxDirectoryDepth) {
    throw new SnapshotFormatError(directory, "practices directory exceeds the depth budget");
  }
  budget.directories += 1;
  if (budget.directories > limits.maxDirectories) {
    throw new SnapshotFormatError(directory, "snapshot exceeds the directory budget");
  }
  let directoryHandle;
  try {
    directoryHandle = await opendir(directory);
  } catch (error) {
    throw new SnapshotFormatError(directory, "cannot read practices directory", error);
  }
  const paths: string[] = [];
  /* eslint-disable no-await-in-loop -- recursive discovery follows one bounded directory stream */
  for await (const entry of directoryHandle) {
    budget.entries += 1;
    if (budget.entries > limits.maxEntries) {
      throw new SnapshotFormatError(directory, "snapshot exceeds the directory-entry budget");
    }
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new SnapshotFormatError(directory, "symbolic links are not allowed in a snapshot");
    }
    if (entry.isDirectory()) {
      paths.push(...(await discoverPractices(path, limits, budget, depth + 1)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      budget.practiceFiles += 1;
      if (budget.practiceFiles > limits.maxPracticeFiles) {
        throw new SnapshotFormatError(directory, "snapshot exceeds the Practice file budget");
      }
      paths.push(path);
    }
  }
  /* eslint-enable no-await-in-loop */
  return paths.sort();
}

async function readSnapshotFile(
  snapshotPath: string,
  path: string,
  limits: PackDirectoryLimits,
  budget: DecodeBudget,
): Promise<string> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new SnapshotFormatError(snapshotPath, "symbolic links are not allowed in a snapshot");
    }
    if (!metadata.isFile()) {
      throw new SnapshotFormatError(snapshotPath, "snapshot path is not a regular file");
    }
    if (metadata.size > limits.maxFileBytes) {
      throw new SnapshotFormatError(snapshotPath, "snapshot file exceeds the per-file byte budget");
    }
    const contents = await readFile(path);
    if (contents.byteLength > limits.maxFileBytes) {
      throw new SnapshotFormatError(snapshotPath, "snapshot file exceeds the per-file byte budget");
    }
    budget.totalBytes += contents.byteLength;
    if (budget.totalBytes > limits.maxTotalBytes) {
      throw new SnapshotFormatError(snapshotPath, "snapshot exceeds the total byte budget");
    }
    return contents.toString("utf8");
  } catch (error) {
    if (error instanceof SnapshotFormatError) throw error;
    throw new SnapshotFormatError(
      snapshotPath,
      "cannot read " + relativePath(snapshotPath, path),
      error,
    );
  }
}

async function decodePracticeFiles(
  snapshotPath: string,
  practicePaths: readonly string[],
  limits: PackDirectoryLimits,
  budget: DecodeBudget,
): Promise<unknown[]> {
  const practices: unknown[] = [];
  for (const path of practicePaths) {
    // eslint-disable-next-line no-await-in-loop -- decoding shares one total-byte budget
    practices.push(await decodePracticeFile(snapshotPath, path, limits, budget));
  }
  return practices;
}

async function decodeDecisions(
  snapshotPath: string,
  limits: PackDirectoryLimits,
  budget: DecodeBudget,
): Promise<unknown[]> {
  const path = join(snapshotPath, "decisions.yaml");
  let raw: string;
  try {
    raw = await readSnapshotFile(snapshotPath, path, limits, budget);
  } catch (error) {
    if (
      error instanceof SnapshotFormatError &&
      typeof error.rootCause === "object" &&
      error.rootCause !== null &&
      "code" in error.rootCause &&
      error.rootCause.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  let value: unknown;
  try {
    value = parseYaml(raw);
  } catch (error) {
    throw new SnapshotFormatError(snapshotPath, "decisions.yaml cannot be parsed as YAML", error);
  }
  if (!Array.isArray(value)) {
    throw new SnapshotFormatError(snapshotPath, "decisions.yaml must be a top-level sequence");
  }
  return value;
}

export interface DecodedSnapshot {
  candidate: PackCandidate;
  diagnostics: readonly ValidationIssue[];
}

async function decodePracticeFile(
  snapshotPath: string,
  path: string,
  limits: PackDirectoryLimits,
  budget: DecodeBudget,
): Promise<unknown> {
  let frontmatter;
  try {
    frontmatter = parseFrontmatter(await readSnapshotFile(snapshotPath, path, limits, budget));
  } catch (error) {
    if (error instanceof SnapshotFormatError) throw error;
    throw new SnapshotFormatError(
      snapshotPath,
      "cannot parse " + relativePath(snapshotPath, path),
      error,
    );
  }
  return { ...frontmatter.data, body: frontmatter.content };
}

/** Reads Pack files and applies the format validation gate before storage sees a candidate. */
export async function decodeSnapshot(
  snapshotPath: string,
  limits: PackDirectoryLimits = defaultPackDirectoryLimits,
): Promise<DecodedSnapshot> {
  const budget: DecodeBudget = { practiceFiles: 0, entries: 0, directories: 0, totalBytes: 0 };
  const rawPack = await readSnapshotFile(
    snapshotPath,
    join(snapshotPath, "pack.yaml"),
    limits,
    budget,
  );
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawPack);
  } catch (error) {
    throw new SnapshotFormatError(snapshotPath, "pack.yaml cannot be parsed as YAML", error);
  }
  const practicePaths = await discoverPractices(join(snapshotPath, "practices"), limits, budget);
  const practices = await decodePracticeFiles(snapshotPath, practicePaths, limits, budget);
  const sourcePaths: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [index, practice] of practices.entries()) {
    const practicePath = practicePaths[index];
    if (practicePath === undefined) {
      throw new SnapshotFormatError(snapshotPath, "practice discovery changed unexpectedly");
    }
    if (
      typeof practice === "object" &&
      practice !== null &&
      "id" in practice &&
      typeof practice.id === "string"
    ) {
      sourcePaths[practice.id] = relativePath(snapshotPath, practicePath);
    }
  }
  // Candidate construction validates all external YAML and frontmatter
  // values (parsePackInput gates on format before anything is trusted).
  const input = {
    pack: parsedYaml,
    practices,
    decisions: await decodeDecisions(snapshotPath, limits, budget),
  };
  return Object.freeze(createPackCandidate(input, sourcePaths));
}
