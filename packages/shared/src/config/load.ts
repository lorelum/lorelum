import { open, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { load, JSON_SCHEMA } from "js-yaml";

export class ConfigError extends Error {
  constructor() {
    super("The Lorelum configuration file is invalid or unreadable.");
    this.name = "ConfigError";
  }
}

export interface LoadConfigOptions {
  readonly homeDirectory?: string;
  readonly filePath?: string;
}

/** Reads the shared document; consumers validate the sections they own. No writes. */
export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<Readonly<Record<string, unknown>>> {
  const path =
    options.filePath ?? join(options.homeDirectory ?? homedir(), ".lorelum", "config.yaml");
  let file: FileHandle;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return Object.freeze({});
    throw new ConfigError();
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 16_384) throw new ConfigError();
    const source = await file.readFile("utf8");
    if (source.split(/\r?\n/).every((line) => /^\s*(#.*)?$/.test(line))) return Object.freeze({});
    const document: unknown = load(source, { schema: JSON_SCHEMA });
    // An empty/comment-only YAML file is an empty config; explicit null is invalid.
    if (document === undefined) return Object.freeze({});
    if (document === null || typeof document !== "object" || Array.isArray(document))
      throw new ConfigError();
    return Object.freeze(document as Record<string, unknown>);
  } catch {
    // YAML parser errors can contain configuration values. Do not expose them.
    throw new ConfigError();
  } finally {
    await file.close();
  }
}
