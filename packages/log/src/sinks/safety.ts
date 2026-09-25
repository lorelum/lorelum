import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/** The two managed shapes a diagnostics target can have. */
export type ManagedTargetKind = "directory" | "file";

/**
 * Injected stat facts. Keeping this a plain interface lets tests decide
 * ownership and type outcomes without needing a privileged process.
 */
export interface ManagedTargetFacts {
  readonly isSymbolicLink: boolean;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly nlink: number;
  /** Permission and special bits exactly as `stats.mode` reports them. */
  readonly mode: number;
  /** Owner uid; `undefined` when the platform does not report one. */
  readonly uid: number | undefined;
}

export type UnsafeTargetReason =
  | "symlink"
  | "wrong-type"
  | "multiple-links"
  | "foreign-owner"
  | "owner-bits-insufficient";

export type ManagedTargetVerdict =
  | { readonly verdict: "safe" }
  | { readonly verdict: "repairable"; readonly mode: number }
  | { readonly verdict: "unsafe"; readonly reason: UnsafeTargetReason };

export interface EvaluateManagedTargetOptions {
  readonly platform?: NodeJS.Platform;
  readonly currentUid?: number;
}

const GROUP_OTHER_BITS = 0o077;
/** Includes setuid/setgid/sticky; tightening only ever clears group/other. */
const MODE_BITS = 0o7777;

function ownerBitsSufficient(kind: ManagedTargetKind, mode: number): boolean {
  return kind === "directory" ? (mode & 0o700) === 0o700 : (mode & 0o600) === 0o600;
}

/**
 * Decides whether a managed diagnostics target is safe to write through,
 * repairable by only clearing group/other permission bits, or must not be
 * touched. Pure: every fact comes in through `facts` and `options`.
 */
export function evaluateManagedTarget(
  facts: ManagedTargetFacts,
  kind: ManagedTargetKind,
  options: EvaluateManagedTargetOptions = {},
): ManagedTargetVerdict {
  if (facts.isSymbolicLink) return { verdict: "unsafe", reason: "symlink" };
  if (kind === "directory" ? !facts.isDirectory : !facts.isFile) {
    return { verdict: "unsafe", reason: "wrong-type" };
  }
  const platform = options.platform ?? process.platform;
  // Windows reports neither a uid nor meaningful mode bits; there privacy is
  // the per-user profile root, so only the structural checks apply.
  if (platform === "win32") return { verdict: "safe" };
  if (kind === "file" && facts.nlink !== 1) {
    return { verdict: "unsafe", reason: "multiple-links" };
  }
  const currentUid = options.currentUid ?? process.getuid?.();
  if (facts.uid === undefined || currentUid === undefined || facts.uid !== currentUid) {
    return { verdict: "unsafe", reason: "foreign-owner" };
  }
  if (!ownerBitsSufficient(kind, facts.mode)) {
    // A repair must never add owner bits, so an unusable owner mode is not
    // repairable (for example a `0505` directory or an `0044` file).
    return { verdict: "unsafe", reason: "owner-bits-insufficient" };
  }
  if ((facts.mode & GROUP_OTHER_BITS) === 0) return { verdict: "safe" };
  return { verdict: "repairable", mode: facts.mode & MODE_BITS & ~GROUP_OTHER_BITS };
}

function factsFromStats(stats: {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  nlink: number;
  mode: number;
  uid: number;
}): ManagedTargetFacts {
  return {
    isSymbolicLink: stats.isSymbolicLink(),
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    nlink: stats.nlink,
    mode: stats.mode,
    uid: stats.uid,
  };
}

/** A repair that tightening performed, kept for the per-invocation outcome. */
export interface ManagedRepairFact {
  readonly path: string;
  readonly kind: ManagedTargetKind;
  readonly beforeMode: number;
  readonly afterMode: number;
}

/** Categorized failure of a managed location, consumed by the per-invocation outcome. */
export type ManagedLogLocationFailure =
  | {
      readonly kind: "location-unavailable";
      readonly reason: UnsafeTargetReason;
      readonly path: string;
    }
  | { readonly kind: "location-error"; readonly path: string; readonly error: string }
  | { readonly kind: "write-failed"; readonly path: string; readonly error: string };

/** Typed rejection for a managed location that cannot be safely used. */
export class ManagedLogLocationError extends Error {
  constructor(
    readonly reason: UnsafeTargetReason,
    readonly path: string,
  ) {
    super(`Managed log location is unavailable (${reason}): ${path}`);
    this.name = "ManagedLogLocationError";
  }
}

export interface InspectResult {
  readonly verdict: ManagedTargetVerdict;
  readonly observedMode: number;
  /** Present when a repair was applied through the same descriptor. */
  readonly repair?: ManagedRepairFact;
}

/**
 * Verifies and optionally tightens one already-open descriptor. Evaluation and
 * repair are bound to the same open file description, so a path replaced after
 * the check cannot redirect the chmod to another object.
 */
export async function inspectAndTightenHandle(
  handle: FileHandle,
  path: string,
  kind: ManagedTargetKind,
): Promise<InspectResult> {
  const before = await handle.stat();
  const verdict = evaluateManagedTarget(factsFromStats(before), kind);
  if (verdict.verdict !== "repairable") {
    return { verdict, observedMode: before.mode };
  }
  await handle.chmod(verdict.mode);
  const after = await handle.stat();
  if ((after.mode & GROUP_OTHER_BITS) !== 0) {
    return {
      verdict: { verdict: "unsafe", reason: "owner-bits-insufficient" },
      observedMode: after.mode,
    };
  }
  return {
    verdict: { verdict: "safe" },
    observedMode: before.mode,
    repair: { path, kind, beforeMode: before.mode, afterMode: after.mode },
  };
}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0);
const FILE_FLAGS = constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);

export function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}

/** How the single managed-location walk treats a missing segment. */
export interface WalkManagedLocationOptions {
  /**
   * Create missing segments with the intended private mode (sink startup).
   * When false the walk only tightens what already exists and never creates —
   * creation then stays with the owning consumer (for example the Backend
   * daemon's strict directory checks).
   */
  readonly createMissing: boolean;
}

function segmentsBetween(trusted: string, target: string): readonly string[] {
  const suffix = relative(trusted, target);
  if (suffix === ".." || suffix.startsWith(`..${sep}`)) {
    throw new Error("Managed log directory escaped its root.");
  }
  return suffix === "" ? [] : suffix.split(sep).filter(Boolean);
}

async function walkSegment(
  directory: string,
  repairs: ManagedRepairFact[],
  createMissing: boolean,
): Promise<void> {
  const existing = await inspectAndTightenDirectory(directory);
  if (existing === undefined) {
    if (!createMissing) return;
    let created = false;
    await mkdir(directory, { mode: 0o700 }).then(
      () => {
        created = true;
      },
      (error: unknown) => {
        if (!hasCode(error, "EEXIST")) throw error;
      },
    );
    // Only a directory this process created is forced back to the intended
    // mode; umask may have stripped owner bits at creation time. A directory
    // that appeared meanwhile (EEXIST above) takes the existing-segment path.
    if (created) await chmod(directory, 0o700);
    const fresh = await inspectAndTightenDirectory(directory);
    if (fresh === undefined) throw new ManagedLogLocationError("wrong-type", directory);
    if (fresh.verdict.verdict === "unsafe") {
      throw new ManagedLogLocationError(fresh.verdict.reason, directory);
    }
    if (fresh.repair) repairs.push(fresh.repair);
    return;
  }
  if (existing.verdict.verdict === "unsafe") {
    throw new ManagedLogLocationError(existing.verdict.reason, directory);
  }
  if (existing.repair) repairs.push(existing.repair);
}

/**
 * The one walk over a managed location: from the trusted directory down to
 * the target it verifies and tightens every existing segment, throwing a
 * typed error on the first unrepairable one. With `createMissing` it also
 * establishes missing segments with the intended private mode (the sink's
 * startup path); without it nothing is ever created. Repairs are pushed into
 * `repairs` as the walk proceeds, so a failure partway through still reports
 * the tightenings that happened before it.
 */
export async function walkManagedLocation(
  trustedDirectory: string,
  targetDirectory: string,
  options: WalkManagedLocationOptions,
  repairs: ManagedRepairFact[] = [],
): Promise<readonly ManagedRepairFact[]> {
  const trusted = resolve(trustedDirectory);
  const target = resolve(targetDirectory);
  const segments = segmentsBetween(trusted, target);
  if (options.createMissing) {
    // A trusted path that exists in an odd shape (for example a symlink) must
    // reach the typed inspection below, not surface as a raw mkdir failure.
    await mkdir(trusted, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
      if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTDIR") && !hasCode(error, "ELOOP")) {
        throw error;
      }
    });
  }
  await walkSegment(trusted, repairs, options.createMissing);
  let current = trusted;
  for (const segment of segments) {
    current = join(current, segment);
    await walkSegment(current, repairs, options.createMissing);
  }
  return repairs;
}

/**
 * Maps an O_NOFOLLOW open failure to an explicit unsafe reason. Runtimes
 * differ on ELOOP versus ENOTDIR for symlinks, so ENOTDIR is disambiguated
 * with one lstat instead of guessing.
 */
async function openFailureReason(path: string, error: unknown): Promise<UnsafeTargetReason> {
  if (hasCode(error, "ELOOP")) return "symlink";
  if (hasCode(error, "ENOTDIR")) {
    const info = await lstat(path).catch(() => undefined);
    return info !== undefined && info.isSymbolicLink() ? "symlink" : "wrong-type";
  }
  throw error;
}

/**
 * Path-level directory inspection: resolves the path once into a descriptor,
 * then verifies and tightens that same object. Rejections other than ENOENT
 * (for example ELOOP on a symlink) map to an explicit unsafe verdict.
 */
export async function inspectAndTightenDirectory(path: string): Promise<InspectResult | undefined> {
  const handle = await open(path, DIRECTORY_FLAGS).catch(async (error: unknown) => {
    if (isMissing(error)) return undefined;
    throw new ManagedLogLocationError(await openFailureReason(path, error), path);
  });
  if (handle === undefined) return undefined;
  try {
    return await inspectAndTightenHandle(handle, path, "directory");
  } finally {
    await handle.close();
  }
}

/**
 * Path-level inspection for an already existing managed file, without creating
 * it: `undefined` means the target does not exist yet and is therefore not a
 * blocker (the write path owns creation and re-verifies on its own handle).
 */
export async function inspectAndTightenExistingFile(
  path: string,
): Promise<InspectResult | undefined> {
  const handle = await open(path, FILE_FLAGS).catch(async (error: unknown) => {
    if (isMissing(error)) return undefined;
    throw new ManagedLogLocationError(await openFailureReason(path, error), path);
  });
  if (handle === undefined) return undefined;
  try {
    return await inspectAndTightenHandle(handle, path, "file");
  } finally {
    await handle.close();
  }
}
