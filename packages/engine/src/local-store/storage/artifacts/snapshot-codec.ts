import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { parseFrontmatter, parseYaml, type PackInput, type ValidationIssue } from "@lorelum/format";

import { createPackCandidate, type PackCandidate } from "../../model";

import { SnapshotFormatError } from "../errors";

function relativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

async function discoverPractices(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new SnapshotFormatError(directory, "cannot read practices directory", error);
  }
  const discovered = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return discoverPractices(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  const paths = discovered.flat();
  return paths.sort();
}

async function decodeDecisions(snapshotPath: string): Promise<unknown[]> {
  const path = join(snapshotPath, "decisions.yaml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw new SnapshotFormatError(snapshotPath, "cannot read decisions.yaml", error);
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
    frontmatter = parseFrontmatter(await readFile(path, "utf8"));
  } catch (error) {
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
  let rawPack: string;
  try {
    rawPack = await readFile(join(snapshotPath, "pack.yaml"), "utf8");
  } catch (error) {
    throw new SnapshotFormatError(snapshotPath, "cannot read pack.yaml", error);
  }
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawPack);
  } catch (error) {
    throw new SnapshotFormatError(snapshotPath, "pack.yaml cannot be parsed as YAML", error);
  }
  const practicePaths = await discoverPractices(join(snapshotPath, "practices"));
  const practices = await Promise.all(
    practicePaths.map((practicePath) => decodePracticeFile(snapshotPath, practicePath)),
  );
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
  // Candidate construction validates all external YAML and frontmatter values.
  const input = {
    pack: parsedYaml,
    practices,
    decisions: await decodeDecisions(snapshotPath),
  } as PackInput;
  return Object.freeze(createPackCandidate(input, sourcePaths));
}
