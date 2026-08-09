import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { parseFrontmatter, parseYaml, type ValidationIssue } from "@lorelum/format";

import { createPackCandidate, type PackCandidate } from "../../model";

import { SnapshotFormatError } from "../errors";

function relativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

async function discoverPractices(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new SnapshotFormatError(directory, "cannot read practices directory", error);
  }
  const paths: string[] = [];
  async function visit(index: number): Promise<void> {
    const entry = entries[index];
    if (entry === undefined) return;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new SnapshotFormatError(directory, "symbolic links are not allowed in a snapshot");
    }
    if (entry.isDirectory()) {
      paths.push(...(await discoverPractices(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(path);
    }
    await visit(index + 1);
  }
  await visit(0);
  return paths.sort();
}

async function readSnapshotFile(snapshotPath: string, path: string): Promise<string> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new SnapshotFormatError(snapshotPath, "symbolic links are not allowed in a snapshot");
    }
    if (!metadata.isFile()) {
      throw new SnapshotFormatError(snapshotPath, "snapshot path is not a regular file");
    }
    return await readFile(path, "utf8");
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
): Promise<unknown[]> {
  const practices: unknown[] = [];
  async function visit(index: number): Promise<void> {
    const path = practicePaths[index];
    if (path === undefined) return;
    practices.push(await decodePracticeFile(snapshotPath, path));
    await visit(index + 1);
  }
  await visit(0);
  return practices;
}

async function decodeDecisions(snapshotPath: string): Promise<unknown[]> {
  const path = join(snapshotPath, "decisions.yaml");
  let raw: string;
  try {
    raw = await readSnapshotFile(snapshotPath, path);
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

async function decodePracticeFile(snapshotPath: string, path: string): Promise<unknown> {
  let frontmatter;
  try {
    frontmatter = parseFrontmatter(await readSnapshotFile(snapshotPath, path));
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
export async function decodeSnapshot(snapshotPath: string): Promise<DecodedSnapshot> {
  const rawPack = await readSnapshotFile(snapshotPath, join(snapshotPath, "pack.yaml"));
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawPack);
  } catch (error) {
    throw new SnapshotFormatError(snapshotPath, "pack.yaml cannot be parsed as YAML", error);
  }
  const practicePaths = await discoverPractices(join(snapshotPath, "practices"));
  const practices = await decodePracticeFiles(snapshotPath, practicePaths);
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
    decisions: await decodeDecisions(snapshotPath),
  };
  return Object.freeze(createPackCandidate(input, sourcePaths));
}
