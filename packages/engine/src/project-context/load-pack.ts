import { lstat, opendir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  PackSchema,
  PracticeSchema,
  parseFrontmatter,
  parseYaml,
  type Pack,
} from "@lorelum/format";

import { canonicalizePractice } from "../local-store/model/canonical-practice";
import { isPracticeSourcePath } from "../local-store/model/candidate";
import { deepFreeze } from "../local-store/model/freeze";
import type { EffectivePractice, PackSnapshot, PracticeSource } from "../local-store/model/types";

export interface LoadedProjectPack {
  readonly pack: PackSnapshot;
  readonly practices: readonly EffectivePractice[];
  readonly ignoredPracticeIds: readonly string[];
}

export class ProjectPackLoadError extends Error {
  constructor() {
    super("Project Pack cannot be safely loaded.");
    this.name = "ProjectPackLoadError";
  }
}

const MAX_PRACTICE_FILES = 500;
const MAX_ENTRIES = 2_048;
const MAX_DIRECTORIES = 256;
const MAX_DIRECTORY_DEPTH = 32;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

interface Budget {
  entries: number;
  directories: number;
  practiceFiles: number;
  totalBytes: number;
}

function relativePath(rootPath: string, path: string): string {
  return relative(rootPath, path).split(sep).join("/");
}

function snapshotPack(pack: Pack): PackSnapshot {
  return deepFreeze(structuredClone(pack)) as PackSnapshot;
}

async function readRegularFile(root: string, path: string, budget: Budget): Promise<string> {
  const info = await lstat(path).catch(() => undefined);
  if (info === undefined || info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE_BYTES) {
    throw new ProjectPackLoadError();
  }
  const content = await readFile(path).catch(() => undefined);
  if (content === undefined || content.byteLength > MAX_FILE_BYTES)
    throw new ProjectPackLoadError();
  budget.totalBytes += content.byteLength;
  if (budget.totalBytes > MAX_TOTAL_BYTES) throw new ProjectPackLoadError();
  return content.toString("utf8");
}

async function discoverPracticePaths(
  root: string,
  directory: string,
  budget: Budget,
  depth = 0,
): Promise<readonly string[]> {
  if (depth > MAX_DIRECTORY_DEPTH) throw new ProjectPackLoadError();
  budget.directories += 1;
  if (budget.directories > MAX_DIRECTORIES) throw new ProjectPackLoadError();
  const handle = await opendir(directory).catch(() => undefined);
  if (handle === undefined) throw new ProjectPackLoadError();
  const paths: string[] = [];
  /* eslint-disable no-await-in-loop -- bounded recursive traversal preserves one budget. */
  for await (const entry of handle) {
    budget.entries += 1;
    if (budget.entries > MAX_ENTRIES || entry.isSymbolicLink()) throw new ProjectPackLoadError();
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await discoverPracticePaths(root, path, budget, depth + 1)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      budget.practiceFiles += 1;
      if (budget.practiceFiles > MAX_PRACTICE_FILES) throw new ProjectPackLoadError();
      const sourcePath = relativePath(root, path);
      if (!isPracticeSourcePath(sourcePath)) throw new ProjectPackLoadError();
      paths.push(path);
    }
  }
  /* eslint-enable no-await-in-loop */
  return Object.freeze(paths.sort());
}

/**
 * Decode a project Pack without turning one malformed Practice into a Pack-wide
 * outage. Pack metadata and filesystem containment remain all-or-nothing.
 */
export async function loadProjectPack(rootPath: string): Promise<LoadedProjectPack> {
  const root = await lstat(rootPath).catch(() => undefined);
  if (root === undefined || root.isSymbolicLink() || !root.isDirectory()) {
    throw new ProjectPackLoadError();
  }
  const budget: Budget = { entries: 0, directories: 0, practiceFiles: 0, totalBytes: 0 };
  let pack: Pack;
  try {
    const parsed = parseYaml(await readRegularFile(rootPath, join(rootPath, "pack.yaml"), budget));
    const result = PackSchema.safeParse(parsed);
    if (!result.success) throw new ProjectPackLoadError();
    pack = result.data;
  } catch (error) {
    if (error instanceof ProjectPackLoadError) throw error;
    throw new ProjectPackLoadError();
  }

  const paths = await discoverPracticePaths(rootPath, join(rootPath, "practices"), budget);
  const sources: PracticeSource[] = [];
  const ignoredPracticeIds: string[] = [];
  const seenIds = new Set<string>();
  for (const path of paths) {
    let raw: unknown;
    try {
      const frontmatter = parseFrontmatter(await readRegularFile(rootPath, path, budget));
      raw = { ...frontmatter.data, body: frontmatter.content };
    } catch {
      ignoredPracticeIds.push(relativePath(rootPath, path));
      continue;
    }
    const parsed = PracticeSchema.safeParse(raw);
    const declaredId =
      typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string"
        ? raw.id
        : relativePath(rootPath, path);
    if (!parsed.success || seenIds.has(parsed.success ? parsed.data.id : "")) {
      ignoredPracticeIds.push(parsed.success ? parsed.data.id : declaredId);
      continue;
    }
    seenIds.add(parsed.data.id);
    const canonicalPractice = canonicalizePractice(parsed.data);
    const sourcePath = relativePath(rootPath, path);
    sources.push(
      Object.freeze({
        packName: pack.name,
        practiceId: parsed.data.id,
        contentDigest: canonicalPractice.contentDigest,
        sourcePath,
        canonicalPractice,
      }),
    );
  }

  const practices = sources
    .map(
      (source): EffectivePractice =>
        Object.freeze({
          practiceId: source.practiceId,
          contentDigest: source.contentDigest,
          canonicalContent: source.canonicalPractice.canonicalContent,
          practice: source.canonicalPractice.practice,
          sources: Object.freeze([source]),
        }),
    )
    .sort((left, right) => left.practiceId.localeCompare(right.practiceId));
  return Object.freeze({
    pack: snapshotPack(pack),
    practices: Object.freeze(practices),
    ignoredPracticeIds: Object.freeze(ignoredPracticeIds.sort()),
  });
}
