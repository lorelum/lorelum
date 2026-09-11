import { homedir } from "node:os";
import { join } from "node:path";

export interface LorelumPaths {
  readonly rootDirectory: string;
  readonly configFile: string;
}

/** Resolve the shared Lorelum paths without touching the filesystem. */
export function resolveLorelumPaths(homeDirectory = homedir()): LorelumPaths {
  const rootDirectory = join(homeDirectory, ".lorelum");
  return Object.freeze({
    rootDirectory,
    configFile: join(rootDirectory, "config.yaml"),
  });
}
