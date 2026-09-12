import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

const CACHE_SCHEMA_VERSION = 1;

export interface NativeBuildCachePathOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface NativeBuildCacheKeyInput {
  readonly target: string;
  readonly recipeIdentity: string;
  readonly cmakeVersion: string;
  readonly cmakeArchiveSha256: string;
  readonly compiler: string;
  readonly sdkVersion: string;
}

/** Resolve developer-only cache state without reading Lorelum's user configuration. */
export function nativeBuildCacheRoot(options: NativeBuildCachePathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;
  if (platform === "darwin")
    return join(homeDirectory, "Library", "Caches", "Lorelum", "native", "v1");
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    return win32.join(
      localAppData && win32.isAbsolute(localAppData)
        ? localAppData
        : win32.join(homeDirectory, "AppData", "Local"),
      "Lorelum",
      "Cache",
      "native",
      "v1",
    );
  }
  const xdgCache = environment.XDG_CACHE_HOME;
  return join(
    xdgCache && isAbsolute(xdgCache) ? xdgCache : join(homeDirectory, ".cache"),
    "lorelum",
    "native",
    "v1",
  );
}

export function nativeBuildCacheKey(input: NativeBuildCacheKeyInput): string {
  return stableSha256({ cacheSchemaVersion: CACHE_SCHEMA_VERSION, ...input });
}

export function nativeBuildCacheEntryDirectory(
  cacheRoot: string,
  target: string,
  cacheKey: string,
): string {
  return join(cacheRoot, target, cacheKey);
}

export function stableSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
