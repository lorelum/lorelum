import { open, type FileHandle } from "node:fs/promises";
import { load, JSON_SCHEMA, YAMLException } from "js-yaml";
import { ConfigError } from "../failure";
import { resolveLorelumPaths } from "../paths/lorelum";

export const MAX_CONFIG_BYTES = 16_384;
export { ConfigError } from "../failure";

export interface LoadConfigOptions {
  readonly homeDirectory?: string;
  readonly filePath?: string;
}

export type ConfigDocument = Readonly<Record<string, unknown>>;
export type ConfigReader = () => Promise<ConfigDocument>;

/** Reads the shared document; consumers validate the sections they own. No writes. */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<ConfigDocument> {
  const path = options.filePath ?? resolveLorelumPaths(options.homeDirectory).configFile;
  const source = { kind: "file" as const, path };
  let file: FileHandle;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return Object.freeze({});
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EISDIR")
      throw new ConfigError({ kind: "document", source, reason: "not-file" });
    throw new ConfigError({ kind: "document", source, reason: "unreadable" });
  }
  try {
    const info = await file.stat().catch(() => {
      throw new ConfigError({ kind: "document", source, reason: "unreadable" });
    });
    if (!info.isFile()) throw new ConfigError({ kind: "document", source, reason: "not-file" });
    if (info.size > MAX_CONFIG_BYTES)
      throw new ConfigError({ kind: "document", source, reason: "too-large" });
    let contents: string;
    try {
      contents = await file.readFile("utf8");
    } catch {
      throw new ConfigError({ kind: "document", source, reason: "unreadable" });
    }
    if (contents.split(/\r?\n/).every((line) => /^\s*(#.*)?$/.test(line))) return Object.freeze({});
    let document: unknown;
    try {
      document = load(contents, { schema: JSON_SCHEMA });
    } catch (error) {
      if (!(error instanceof YAMLException)) throw new ConfigError();
      const location =
        error.mark === undefined
          ? undefined
          : { line: error.mark.line + 1, column: error.mark.column + 1 };
      throw new ConfigError({
        kind: "document",
        source,
        reason: "yaml-syntax",
        ...(location === undefined ? {} : { location }),
      });
    }
    // An empty/comment-only YAML file is an empty config; explicit null is invalid.
    if (document === undefined) return Object.freeze({});
    if (document === null || typeof document !== "object" || Array.isArray(document))
      throw new ConfigError({ kind: "document", source, reason: "root-shape" });
    return Object.freeze(document as Record<string, unknown>);
  } finally {
    await file.close();
  }
}
