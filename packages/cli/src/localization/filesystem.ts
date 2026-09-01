import { lstat, mkdir, opendir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { defaultPackDirectoryLimits } from "@lorelum/engine";
import { CliError, cliErrorCodes } from "../runtime/errors.js";

const limits = defaultPackDirectoryLimits;

export interface DiscoveredPackFiles {
  readonly canonical: ReadonlyMap<string, string>;
  readonly localized: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

function fail(message: string): never {
  throw new CliError(cliErrorCodes.localizationInvalid, message);
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata === undefined || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a regular directory.`);
  }
}

interface Budget {
  entries: number;
  directories: number;
  files: number;
  bytes: number;
}

async function discoverMarkdown(
  root: string,
  directory: string,
  budget: Budget,
  depth = 0,
): Promise<Map<string, string>> {
  if (depth > limits.maxDirectoryDepth) fail("Pack directory exceeds the depth budget.");
  budget.directories += 1;
  if (budget.directories > limits.maxDirectories) fail("Pack exceeds the directory budget.");
  const output = new Map<string, string>();
  let handle;
  try {
    handle = await opendir(directory);
  } catch {
    fail(`Cannot read ${relativePath(root, directory)}.`);
  }
  for await (const entry of handle) {
    budget.entries += 1;
    if (budget.entries > limits.maxEntries) fail("Pack exceeds the directory-entry budget.");
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail("Symbolic links are not allowed in localization sources.");
    if (entry.isDirectory()) {
      for (const [name, text] of await discoverMarkdown(root, path, budget, depth + 1)) {
        if (output.has(name)) fail(`Duplicate source path ${name}.`);
        output.set(name, text);
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    budget.files += 1;
    if (budget.files > limits.maxPracticeFiles) fail("Pack exceeds the Practice file budget.");
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      fail("Localization source is not a regular file.");
    if (metadata.size > limits.maxFileBytes)
      fail("Localization source exceeds the per-file byte budget.");
    const bytes = await readFile(path);
    budget.bytes += bytes.byteLength;
    if (budget.bytes > limits.maxTotalBytes) fail("Pack exceeds the total byte budget.");
    output.set(relativePath(root, path), bytes.toString("utf8"));
  }
  return output;
}

export async function discoverPackFiles(packRoot: string): Promise<DiscoveredPackFiles> {
  await assertDirectory(packRoot, "Pack root");
  const budget: Budget = { entries: 0, directories: 0, files: 0, bytes: 0 };
  const canonicalRoot = join(packRoot, "practices");
  const canonical = await discoverMarkdown(packRoot, canonicalRoot, budget);
  const localized = new Map<string, ReadonlyMap<string, string>>();
  const i18nRoot = join(packRoot, "i18n");
  const i18nMetadata = await lstat(i18nRoot).catch(() => undefined);
  if (i18nMetadata?.isSymbolicLink()) fail("i18n must not be a symbolic link.");
  if (i18nMetadata?.isDirectory()) {
    const handle = await opendir(i18nRoot);
    for await (const entry of handle) {
      budget.entries += 1;
      if (budget.entries > limits.maxEntries) fail("Pack exceeds the directory-entry budget.");
      if (entry.isSymbolicLink()) fail("Symbolic links are not allowed in localization sources.");
      if (!entry.isDirectory()) continue;
      const localeRoot = join(i18nRoot, entry.name);
      const locale = entry.name;
      const practicesRoot = join(localeRoot, "practices");
      const practicesMetadata = await lstat(practicesRoot).catch(() => undefined);
      if (practicesMetadata?.isSymbolicLink())
        fail("Localized practices must not be symbolic links.");
      if (!practicesMetadata?.isDirectory()) {
        localized.set(locale, new Map());
        continue;
      }
      localized.set(locale, await discoverMarkdown(packRoot, practicesRoot, budget));
    }
  }
  return { canonical, localized };
}

export async function readOptionalFile(path: string): Promise<string | undefined> {
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata === undefined) return undefined;
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail("Path is not a regular file.");
  if (metadata.size > limits.maxFileBytes) fail("File exceeds the per-file byte budget.");
  return (await readFile(path)).toString("utf8");
}

export async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.lorelum-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await import("node:fs/promises").then(({ unlink }) => unlink(temporary).catch(() => undefined));
    throw error;
  }
}
