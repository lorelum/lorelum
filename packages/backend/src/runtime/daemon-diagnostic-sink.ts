/* eslint-disable no-await-in-loop -- Candidates are tried strictly in order: primary first, then the designed fallback. */
import { defaultDiagnosticsFallbackDirectory, defaultLogDirectory } from "@lorelum/config";
import { inspectAndTightenExistingFile, walkManagedLocation } from "@lorelum/log";
import { dirname, join } from "node:path";
import { readdir } from "node:fs/promises";

import { BackendError } from "../protocol/errors";
import {
  createPrivateJsonlSink,
  managedRotationSuffix,
  type PrivateJsonlSink,
} from "./private-jsonl-sink";

const CURRENT_FILE = "current.jsonl";

/** What the daemon ended up doing about its own diagnostics persistence. */
export interface DaemonDiagnosticsSelection {
  readonly sink?: PrivateJsonlSink;
  readonly degraded: boolean;
  readonly usedDirectory?: string;
  readonly fallbackUsed: boolean;
  /** Category of the primary failure, also reported when the fallback covered it. */
  readonly failureCategory?: string;
}

function failureCategory(error: unknown): string {
  if (error instanceof BackendError) return error.code;
  return error instanceof Error ? error.name : String(error);
}

/**
 * Heals every managed segment file in the daemon's sink directory: the current
 * file and its bounded rotations. `PrivateJsonlSink.runPreflight` validates the
 * whole rotated set, so healing only the current file would let a widened
 * rotation (the `chmod -R` case) silently divert the daemon to the fallback.
 */
async function healDaemonSinkFiles(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    // One name grammar with the sink preflight: the current file plus its
    // numeric rotations.
    if (
      entry.name !== CURRENT_FILE &&
      managedRotationSuffix(entry.name, CURRENT_FILE) === undefined
    ) {
      continue;
    }
    await inspectAndTightenExistingFile(join(directory, entry.name)).catch(() => undefined);
  }
}

/**
 * Selects the daemon's diagnostics sink: self-heal the primary managed
 * location, then the designed private fallback, then degrade to no sink.
 * Degradation never blocks startup — only runtime state keeps that authority.
 *
 * The healed chain runs from the log root's parent down to `<root>/backend`.
 * In production that parent is the Lorelum root and is disjoint from the
 * runtime state directory, whose strict checks are untouched. Under injected
 * test configurations the log root may live inside the runtime directory, so
 * the first healed segment can coincide with it; tightening only ever moves it
 * toward the private mode the strict check itself requires, and no production
 * path reaches that overlap.
 */
export async function selectDaemonDiagnosticSink(
  logDirectory: string | undefined,
  fallbackLogDirectory: string | undefined,
): Promise<DaemonDiagnosticsSelection> {
  const candidates = [
    { directory: join(logDirectory ?? defaultLogDirectory(), "backend"), fallback: false },
    {
      directory: join(fallbackLogDirectory ?? defaultDiagnosticsFallbackDirectory(), "backend"),
      fallback: true,
    },
  ];
  let primaryFailure: string | undefined;
  for (const candidate of candidates) {
    // Best-effort self-heal of the managed chain and the managed segment
    // files; the sink preflight below stays the authority on usability. The
    // walk never creates: missing directories stay with checkDirectory's
    // strict startup authority.
    await walkManagedLocation(dirname(dirname(candidate.directory)), candidate.directory, {
      createMissing: false,
    }).catch(() => undefined);
    await healDaemonSinkFiles(candidate.directory);
    const sink = await createPrivateJsonlSink({
      directory: candidate.directory,
      fileName: CURRENT_FILE,
    }).catch((error: unknown) => {
      if (!candidate.fallback) primaryFailure ??= failureCategory(error);
      return undefined;
    });
    if (sink !== undefined) {
      return {
        sink,
        degraded: false,
        usedDirectory: candidate.directory,
        fallbackUsed: candidate.fallback,
        ...(primaryFailure === undefined ? {} : { failureCategory: primaryFailure }),
      };
    }
  }
  return {
    degraded: true,
    fallbackUsed: false,
    ...(primaryFailure === undefined ? {} : { failureCategory: primaryFailure }),
  };
}
