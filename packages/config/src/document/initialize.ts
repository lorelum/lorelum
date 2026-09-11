/* eslint-disable no-await-in-loop -- Validate each parent before creating its child directory. */
import { lstat, link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { dump } from "js-yaml";
import { ConfigError, MAX_CONFIG_BYTES, type LoadConfigOptions } from "./load";
import { resolveLorelumPaths } from "../paths/lorelum";

const INITIAL_COMMENT = "# Lorelum shared configuration. Edit sections as needed.\n";

export interface InitializeConfigResult {
  readonly created: boolean;
  readonly filePath: string;
}

/** Create the shared config once; existing files are never merged or replaced. */
export async function initializeConfig(
  options: LoadConfigOptions = {},
  initialDocument: Readonly<Record<string, unknown>> = {},
): Promise<InitializeConfigResult> {
  const filePath = options.filePath ?? resolveLorelumPaths(options.homeDirectory).configFile;
  if (!isAbsolute(filePath)) throw new ConfigError();
  const absoluteFilePath = resolve(filePath);
  const parent = dirname(absoluteFilePath);
  await ensurePrivateDirectory(parent);
  if (await inspectExistingTarget(absoluteFilePath))
    return { created: false, filePath: absoluteFilePath };

  const source = serializeInitialDocument(initialDocument);
  const temporary = `${absoluteFilePath}.tmp-${randomUUID()}`;
  let temporaryCreated = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    temporaryCreated = true;
    try {
      await file.writeFile(source, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, absoluteFilePath);
      return { created: true, filePath: absoluteFilePath };
    } catch (error) {
      if (hasCode(error, "EEXIST")) {
        await inspectExistingTarget(absoluteFilePath);
        return { created: false, filePath: absoluteFilePath };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError();
  } finally {
    if (temporaryCreated) await unlink(temporary).catch(() => {});
  }
}

function serializeInitialDocument(document: Readonly<Record<string, unknown>>): string {
  if (document === null || typeof document !== "object" || Array.isArray(document))
    throw new ConfigError();
  try {
    const json = JSON.stringify(document);
    if (json === undefined) throw new ConfigError();
    const source = `${INITIAL_COMMENT}${dump(document, { noRefs: true, lineWidth: -1 })}`;
    if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) throw new ConfigError();
    return source;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError();
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    current = `${current}${current.endsWith("/") || current.endsWith("\\") ? "" : "/"}${part}`;
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ConfigError();
    } catch (error) {
      if (!hasCode(error, "ENOENT")) {
        if (error instanceof ConfigError) throw error;
        throw new ConfigError();
      }
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!hasCode(mkdirError, "EEXIST")) throw new ConfigError();
      }
      const info = await lstat(current).catch(() => undefined);
      if (!info?.isDirectory() || info.isSymbolicLink()) throw new ConfigError();
    }
  }
}

async function inspectExistingTarget(path: string): Promise<boolean> {
  const info = await lstat(path).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw new ConfigError();
  });
  if (info === undefined) return false;
  if (info.isSymbolicLink() || !info.isFile()) throw new ConfigError();
  return true;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
