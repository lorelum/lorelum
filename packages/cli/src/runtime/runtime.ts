import {
  loadConfig,
  resolveConfigPath,
  type ConfigEnvironment,
  type LoadedConfig,
} from "./config.js";
import { createNodePackFileSystem, createPackLoader, type PackLoader } from "@lorelum/engine";
import type { UnvalidatedPackInput } from "@lorelum/format";
import { resolve } from "node:path";
import { Logger } from "./logger.js";
import type { OutputWriter } from "../output/protocol.js";

export interface CliRuntime {
  readonly configPath: string;
  readonly configSource: "default" | "environment" | "explicit";
  readonly logger: Logger;
  loadConfig(): Promise<LoadedConfig>;
  loadPack(path: string): Promise<UnvalidatedPackInput>;
}

export interface RuntimeOptions extends ConfigEnvironment {
  errorWriter?: OutputWriter;
  packLoader?: PackLoader;
  workingDirectory?: string;
}

export function createRuntime(options: RuntimeOptions = {}): CliRuntime {
  const resolved = resolveConfigPath(options);
  const explicit = resolved.source !== "default";
  const packLoader = options.packLoader ?? createPackLoader(createNodePackFileSystem());
  const workingDirectory = options.workingDirectory ?? process.cwd();

  return {
    configPath: resolved.path,
    configSource: resolved.source,
    logger: new Logger(options.errorWriter ?? process.stderr),
    loadConfig: () => loadConfig(resolved.path, explicit, options.fileSystem),
    loadPack: (path) => packLoader.load(resolve(workingDirectory, path)),
  };
}
