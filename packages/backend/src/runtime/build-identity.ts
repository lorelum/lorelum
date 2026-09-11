/* eslint-disable no-await-in-loop -- Hash files in deterministic order without materializing the entire source tree. */
import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Source identity binds checkout + production source; compiled identity binds executable bytes. */
export async function currentBuildIdentity(entrypoint: string): Promise<string> {
  const hash = createHash("sha256");
  if (isCompiledEntrypoint(entrypoint)) {
    hash.update(await readFile(process.execPath));
  } else {
    const root = await realpath(resolve(dirname(entrypoint), "../../.."));
    hash.update(root);
    for (const name of ["backend", "cli", "config", "engine", "format", "shared"]) {
      hash.update(await readFile(join(root, "packages", name, "package.json")));
      await includeDirectory(join(root, "packages", name, "src"), hash);
    }
    hash.update(await readFile(join(root, "bun.lock")));
    await includeDirectory(join(root, "native", "embedding"), hash);
  }
  return hash.digest("hex");
}
async function includeDirectory(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.includes(".test.") || entry.name.includes(".test-helper.")) continue;
    const file = join(path, entry.name);
    if (entry.isDirectory()) await includeDirectory(file, hash);
    else if (entry.isFile()) {
      hash.update(entry.name);
      hash.update(await readFile(file));
    }
  }
}

/** Bun has used both virtual-root forms; normalize separators for Windows builds. */
export function isCompiledEntrypoint(entrypoint: string): boolean {
  const normalized = entrypoint.replaceAll("\\", "/");
  return normalized.includes("/$bunfs/") || /^[A-Za-z]:\/~BUN\//.test(normalized);
}
