import { resolve } from "node:path";

import type { StorageRoot } from "@lorelum/engine";

import { invalidInvocationError } from "../runtime/errors.js";

/** Select the invocation Store while preserving the user-level default. */
export function resolveInvocationStorageRoot(
  override: unknown,
  fallback: StorageRoot,
  workingDirectory = process.cwd(),
): StorageRoot {
  if (override === undefined) return fallback;
  if (typeof override !== "string" || override.length === 0) throw invalidInvocationError();
  return { rootPath: resolve(workingDirectory, override) };
}
