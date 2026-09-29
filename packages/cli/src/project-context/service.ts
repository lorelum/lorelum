import { resolve } from "node:path";

import {
  defaultQueryArtifactCacheRoot,
  resolveProjectContext,
  type LocalStore,
  type ProjectContextSnapshot,
  type StorageRoot,
} from "@lorelum/engine";

import { invalidInvocationError } from "../runtime/errors";

export interface ProjectInvocationOptions {
  readonly projectRoot?: string;
  readonly noProject: boolean;
  readonly cacheRoot: string;
}

export interface BackendProjectTargetOptions {
  readonly cacheRoot?: string;
  readonly projectContext?: {
    readonly cacheRoot: string;
    readonly startDirectory: string;
    readonly projectRoot?: string;
  };
}

export type ProjectContextResolver = (
  storageRoot: StorageRoot,
  options: ProjectInvocationOptions,
) => Promise<ProjectContextSnapshot | undefined>;

function optionalPath(
  value: unknown,
  fallback: string,
  workingDirectory: string,
  option: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0)
    throw invalidInvocationError(`${option} must be a non-empty path.`);
  return resolve(workingDirectory, value);
}

/** Parse all project-related globals once, without any source or Backend I/O. */
export function resolveProjectInvocationOptions(
  options: Readonly<Record<string, unknown>>,
  workingDirectory = process.cwd(),
): ProjectInvocationOptions {
  const projectRoot =
    options.projectRoot === undefined
      ? undefined
      : optionalPath(options.projectRoot, "", workingDirectory, "--project-root");
  // Commander exposes --no-project as the negated `project: false` option.
  // Keep noProject as the product-facing name while accepting its parser form.
  const noProject = options.noProject === true || options.project === false;
  if (options.noProject !== undefined && options.noProject !== true) {
    throw invalidInvocationError("--no-project is a flag and takes no value.");
  }
  return Object.freeze({
    ...(projectRoot === undefined ? {} : { projectRoot }),
    noProject,
    cacheRoot: optionalPath(
      options.cacheRoot,
      defaultQueryArtifactCacheRoot(),
      workingDirectory,
      "--cache-root",
    ),
  });
}

export function createProjectContextResolver(
  store: Pick<LocalStore, "readEffectivePracticeSnapshot">,
): ProjectContextResolver {
  return (storageRoot, options) =>
    resolveProjectContext({
      store,
      storageRoot,
      ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
      noProject: options.noProject,
    });
}

/**
 * Preserve one CLI decision for all Backend-hosted semantic operations. The
 * daemon resolves the full corpus so its response metadata and queried rows
 * come from the same final snapshot; CLI-only keyword/get paths still use the
 * local resolver directly.
 */
export function backendProjectTargetOptions(
  options: ProjectInvocationOptions,
  workingDirectory = process.cwd(),
): BackendProjectTargetOptions {
  if (options.noProject) return Object.freeze({ cacheRoot: options.cacheRoot });
  return Object.freeze({
    projectContext: Object.freeze({
      cacheRoot: options.cacheRoot,
      startDirectory: resolve(workingDirectory),
      ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    }),
  });
}
