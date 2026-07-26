import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { z } from "zod";

import { CliError } from "./errors.js";

const maxConfigBytes = 64 * 1024;
const configSchema = z.object({ version: z.literal(1) }).strict();

export type LorelumConfig = z.infer<typeof configSchema>;

export interface ConfigFileMetadata {
  identity: string;
  kind: "file" | "other" | "symlink";
  size: number;
}

export interface ConfigFileHandle {
  close(): Promise<void>;
  read(maxBytes: number): Promise<string>;
  stat(): Promise<ConfigFileMetadata>;
}

/** Filesystem boundary for deterministic, bounded configuration reads. */
export interface ConfigFileSystem {
  lstat(path: string): Promise<ConfigFileMetadata>;
  openReadOnly(path: string): Promise<ConfigFileHandle>;
}

export interface ConfigEnvironment {
  env?: Record<string, string | undefined>;
  explicitPath?: string;
  fileSystem?: ConfigFileSystem;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}

export interface ResolvedConfigPath {
  path: string;
  source: "default" | "environment" | "explicit";
}

export interface LoadedConfig {
  configuration: LorelumConfig;
  source: "default" | "file";
}

export function resolveConfigPath(options: ConfigEnvironment = {}): ResolvedConfigPath {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const explicitPath = options.explicitPath;

  if (explicitPath !== undefined) {
    return { path: resolveAbsolutePath(path, explicitPath, "--config"), source: "explicit" };
  }

  if (environment.LORELUM_CONFIG !== undefined) {
    return {
      path: resolveAbsolutePath(path, environment.LORELUM_CONFIG, "LORELUM_CONFIG"),
      source: "environment",
    };
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  if (platform === "win32") {
    return {
      path: path.join(
        resolveAbsolutePath(
          path,
          environment.APPDATA ?? path.join(homeDirectory, "AppData", "Roaming"),
          "APPDATA",
        ),
        "Lorelum",
        "config.json",
      ),
      source: "default",
    };
  }

  return {
    path: path.join(
      resolveAbsolutePath(
        path,
        environment.XDG_CONFIG_HOME ?? path.join(homeDirectory, ".config"),
        "XDG_CONFIG_HOME",
      ),
      "lorelum",
      "config.json",
    ),
    source: "default",
  };
}

export async function loadConfig(
  path: string,
  explicit: boolean,
  fileSystem: ConfigFileSystem = createNodeConfigFileSystem(),
): Promise<LoadedConfig> {
  let metadata: ConfigFileMetadata;
  try {
    metadata = await fileSystem.lstat(path);
  } catch (error) {
    if (!explicit && isNotFoundError(error)) {
      return { configuration: { version: 1 }, source: "default" };
    }
    throw new CliError("config.unreadable", "Unable to read the local configuration.");
  }

  if (metadata.kind !== "file") {
    throw new CliError("config.unreadable", "The local configuration must be a regular file.");
  }
  if (metadata.size > maxConfigBytes) {
    throw new CliError("config.too_large", "The local configuration exceeds 64 KiB.");
  }

  let handle: ConfigFileHandle | undefined;
  try {
    handle = await fileSystem.openReadOnly(path);
    const openedMetadata = await handle.stat();
    if (openedMetadata.kind !== "file" || !sameFile(metadata, openedMetadata)) {
      throw new CliError("config.unreadable", "Unable to read the local configuration.");
    }
    if (openedMetadata.size > maxConfigBytes) {
      throw new CliError("config.too_large", "The local configuration exceeds 64 KiB.");
    }

    const contents = await handle.read(maxConfigBytes);
    if (Buffer.byteLength(contents) > maxConfigBytes) {
      throw new CliError("config.too_large", "The local configuration exceeds 64 KiB.");
    }
    return parseConfig(contents);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("config.unreadable", "Unable to read the local configuration.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function resolveAbsolutePath(path: typeof posix, value: string, name: string): string {
  if (value.length === 0 || !path.isAbsolute(value)) {
    throw new CliError("config.path_invalid", `${name} must be an absolute path.`);
  }
  return path.normalize(value);
}

function createNodeConfigFileSystem(): ConfigFileSystem {
  return {
    async lstat(path) {
      return toMetadata(await lstat(path));
    },
    async openReadOnly(path) {
      const handle = await open(path, "r");
      return {
        close: () => handle.close(),
        async read(maxBytes) {
          const content = Buffer.alloc(maxBytes + 1);
          let offset = 0;
          while (offset < content.length) {
            // Descriptor reads can be partial, so each read advances from the prior offset.
            // eslint-disable-next-line no-await-in-loop
            const { bytesRead } = await handle.read(
              content,
              offset,
              content.length - offset,
              offset,
            );
            if (bytesRead === 0) break;
            offset += bytesRead;
          }
          return content.subarray(0, offset).toString("utf8");
        },
        async stat() {
          return toMetadata(await handle.stat());
        },
      };
    },
  };
}

function toMetadata(stats: Stats): ConfigFileMetadata {
  return {
    identity: `${stats.dev}:${stats.ino}`,
    kind: stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other",
    size: stats.size,
  };
}

function parseConfig(contents: string): LoadedConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new CliError("config.invalid_json", "The local configuration is not valid JSON.");
  }

  const result = configSchema.safeParse(parsed);
  if (result.success) return { configuration: result.data, source: "file" };

  if (hasUnknownField(parsed)) {
    throw new CliError(
      "config.unknown_field",
      "The local configuration contains an unsupported field.",
    );
  }
  throw new CliError("config.unsupported_version", "The local configuration must have version 1.");
}

function sameFile(before: ConfigFileMetadata, after: ConfigFileMetadata): boolean {
  return before.identity === after.identity;
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function hasUnknownField(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => key !== "version")
  );
}
