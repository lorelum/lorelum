import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
/* eslint-disable no-await-in-loop -- Each path segment must be checked and tightened in order. */

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

/**
 * Verifies and optionally tightens one already-open descriptor. Evaluation and
 * repair are bound to the same open file description, so a path replaced after
 * the check cannot redirect the chmod to another object. A tighten that does
 * not take effect is refused instead of being retried through the path.
 */
export async function inspectAndTightenHandle(
  handle: FileHandle,
  path: string,
  kind: ManagedTargetKind,
): Promise<ManagedTargetVerdict> {
  const before = await handle.stat();
  const verdict = evaluateManagedTarget(factsFromStats(before), kind);
  if (verdict.verdict !== "repairable") {
    return verdict;
  }
  await handle.chmod(verdict.mode);
  const after = await handle.stat();
  if ((after.mode & GROUP_OTHER_BITS) !== 0) {
    return { verdict: "unsafe", reason: "owner-bits-insufficient" };
  }
  return { verdict: "safe" };
}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0);

export function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}

/**
 * Maps an O_NOFOLLOW open failure to an explicit unsafe reason. Runtimes
 * differ on ELOOP versus ENOTDIR for symlinks, so ENOTDIR is disambiguated
 * with one lstat instead of guessing.
 */
export async function openFailureReason(path: string, error: unknown): Promise<UnsafeTargetReason> {
  if (hasCode(error, "ELOOP")) return "symlink";
  if (hasCode(error, "ENOTDIR")) {
    const info = await lstat(path).catch(() => undefined);
    return info !== undefined && info.isSymbolicLink() ? "symlink" : "wrong-type";
  }
  throw error;
}

/**
 * Structural gate for the trusted directory (the Lorelum root): it must be a
 * user-owned real directory, but its permission bits are neither examined nor
 * changed, and nothing above it is ever inspected. Missing roots are created
 * private; privacy below the root is the subtree walk's job.
 */
async function gateTrustedDirectory(trusted: string): Promise<void> {
  await mkdir(trusted, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
    // An existing odd shape (symlink, plain file) must surface as the typed
    // verdict below, not as a raw mkdir failure.
    if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTDIR") && !hasCode(error, "ELOOP")) {
      throw error;
    }
  });
  const info = await lstat(trusted);
  if (info.isSymbolicLink()) throw new ManagedLogLocationError("symlink", trusted);
  if (!info.isDirectory()) throw new ManagedLogLocationError("wrong-type", trusted);
  const currentUid = process.getuid?.();
  if (process.platform !== "win32" && (info.uid !== currentUid || currentUid === undefined)) {
    throw new ManagedLogLocationError("foreign-owner", trusted);
  }
}

/**
 * Establishes one managed directory below the trusted root: an existing
 * segment is verified and tightened through its own descriptor; a missing
 * segment is created private and set to the intended mode through the same
 * descriptor it is then verified on (umask-proof, never path-chmodded).
 */
async function ensureManagedSegment(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await open(directory, DIRECTORY_FLAGS);
  } catch (error) {
    if (!isMissing(error)) {
      throw new ManagedLogLocationError(await openFailureReason(directory, error), directory);
    }
    await mkdir(directory, { mode: 0o700 }).then(
      () => {
        created = true;
      },
      (mkdirError: unknown) => {
        if (!hasCode(mkdirError, "EEXIST")) throw mkdirError;
      },
    );
    try {
      handle = await open(directory, DIRECTORY_FLAGS);
    } catch (retryError) {
      throw new ManagedLogLocationError(await openFailureReason(directory, retryError), directory);
    }
    if (created) await handle.chmod(0o700);
  }
  try {
    const verdict = await inspectAndTightenHandle(handle, directory, "directory");
    if (verdict.verdict === "unsafe") {
      throw new ManagedLogLocationError(verdict.reason, directory);
    }
  } finally {
    await handle.close();
  }
}

function relativeSegments(trusted: string, target: string): readonly string[] {
  const suffix = relative(trusted, target);
  if (suffix === "") return [];
  if (suffix === ".." || suffix.startsWith(`..${sep}`)) {
    throw new Error("Managed log directory escaped its root.");
  }
  return suffix.split(sep).filter(Boolean);
}

/**
 * The one walk over a managed log location. The trusted directory passes the
 * structural gate only (never tightened, nothing above it touched); every
 * segment strictly below it down to the target directory is verified and,
 * where group/other bits are wide, tightened through the same descriptor.
 */
export async function walkManagedLocation(
  trustedDirectory: string,
  targetDirectory: string,
): Promise<void> {
  const trusted = resolve(trustedDirectory);
  const target = resolve(targetDirectory);
  const segments = relativeSegments(trusted, target);
  await gateTrustedDirectory(trusted);
  let current = trusted;
  for (const segment of segments) {
    current = join(current, segment);
    await ensureManagedSegment(current);
  }
}
