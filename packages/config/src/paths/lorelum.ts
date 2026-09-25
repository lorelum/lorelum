import { homedir } from "node:os";
import { join } from "node:path";

export interface LorelumPaths {
  readonly rootDirectory: string;
  readonly configFile: string;
  readonly registryCatalogFile: string;
}

/** Resolve the shared Lorelum paths without touching the filesystem. */
export function resolveLorelumPaths(homeDirectory = homedir()): LorelumPaths {
  const rootDirectory = join(homeDirectory, ".lorelum");
  return Object.freeze({
    rootDirectory,
    configFile: join(rootDirectory, "config.yaml"),
    registryCatalogFile: join(rootDirectory, "registries.yaml"),
  });
}

/** User-scoped local artifacts that are intentionally separate from config. */
export function defaultFeedbackDirectory(homeDirectory = homedir()): string {
  return join(resolveLorelumPaths(homeDirectory).rootDirectory, "feedback");
}

/** User-scoped records written by CLI, Backend, and Host Hook log sinks. */
export function defaultLogDirectory(homeDirectory = homedir()): string {
  return join(resolveLorelumPaths(homeDirectory).rootDirectory, "logs");
}

/**
 * Designed private fallback for diagnostics when the managed log root cannot
 * be used safely. A sibling of the Lorelum root so a broken `~/.lorelum`
 * cannot also break the fallback, and never a shared temporary directory.
 */
export function defaultDiagnosticsFallbackDirectory(homeDirectory = homedir()): string {
  return join(homeDirectory, ".lorelum-diagnostics");
}
