import { resolve } from "node:path";

import {
  defaultProjectCacheRoot,
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

export type ProjectContextResolver = (
  storageRoot: StorageRoot,
  options: ProjectInvocationOptions,
) => Promise<ProjectContextSnapshot | undefined>;

function optionalPath(value: unknown, fallback: string, workingDirectory: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) throw invalidInvocationError();
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
      : optionalPath(options.projectRoot, "", workingDirectory);
  // Commander exposes --no-project as the negated `project: false` option.
  // Keep noProject as the product-facing name while accepting its parser form.
  const noProject = options.noProject === true || options.project === false;
  if (options.noProject !== undefined && options.noProject !== true) {
    throw invalidInvocationError();
  }
  return Object.freeze({
    ...(projectRoot === undefined ? {} : { projectRoot }),
    noProject,
    cacheRoot: optionalPath(options.cacheRoot, defaultProjectCacheRoot(), workingDirectory),
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
