/* eslint-disable no-await-in-loop -- SQLite lock acquisition polls the OS-backed lock. */
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { cp, lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  verifyNativeArtifact,
  type NativeArtifactManifest,
} from "../../packages/backend/src/runtime/native/embedding/manifest";
import { nativeBuildCacheEntryDirectory } from "./cache-paths";

const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const CACHE_KEY = /^[a-f0-9]{64}$/;
const TARGET = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface NativeBuildCacheOptions {
  readonly cacheRoot: string;
  readonly target: string;
  readonly cacheKey: string;
  readonly candidateDirectory: string;
  readonly validate: (manifest: NativeArtifactManifest) => void;
  readonly build: (outputDirectory: string) => Promise<void>;
  readonly report: (message: string) => void;
}

/** Reuse one verified native artifact across worktrees while keeping each candidate local. */
export async function materializeNativeBuildCache(
  options: NativeBuildCacheOptions,
): Promise<NativeArtifactManifest> {
  assertCacheAddress(options.target, options.cacheKey);
  await ensurePrivateDirectory(options.cacheRoot);
  await ensurePrivateDirectory(join(options.cacheRoot, options.target));
  await ensurePrivateDirectory(join(options.cacheRoot, ".tmp"));
  const entryDirectory = nativeBuildCacheEntryDirectory(
    options.cacheRoot,
    options.target,
    options.cacheKey,
  );
  // Serialize candidate replacement too: two invocations in one worktree must not race on .artifacts.
  return withNativeBuildLock(
    options.cacheRoot,
    options.target,
    options.cacheKey,
    options.report,
    async () => {
      const available = await validArtifact(entryDirectory, options.validate);
      if (available !== undefined) {
        options.report(
          `native: cache hit ${options.target} ${shortKey(options.cacheKey)}; materializing candidate`,
        );
        await materializeCandidate(
          entryDirectory,
          options.candidateDirectory,
          available,
          options.validate,
        );
        return available;
      }
      await rm(entryDirectory, { recursive: true, force: true });
      const temporary = join(
        options.cacheRoot,
        ".tmp",
        `${options.target}-${options.cacheKey}-${randomUUID()}`,
      );
      try {
        options.report(
          `native: cache miss ${options.target} ${shortKey(options.cacheKey)}; building runtime`,
        );
        await mkdir(dirname(temporary), { recursive: true, mode: 0o700 });
        await options.build(temporary);
        const built = await requiredArtifact(temporary, options.validate);
        await mkdir(dirname(entryDirectory), { recursive: true, mode: 0o700 });
        await rename(temporary, entryDirectory);
        await materializeCandidate(
          entryDirectory,
          options.candidateDirectory,
          built,
          options.validate,
        );
        return built;
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
}

async function materializeCandidate(
  entryDirectory: string,
  candidateDirectory: string,
  expected: NativeArtifactManifest,
  validate: (manifest: NativeArtifactManifest) => void,
): Promise<void> {
  const current = await validArtifact(candidateDirectory, validate);
  if (current?.buildIdentity === expected.buildIdentity) return;
  const temporary = `${candidateDirectory}.tmp-${randomUUID()}`;
  const backup = `${candidateDirectory}.previous-${randomUUID()}`;
  let movedPrevious = false;
  let candidateInstalled = false;
  let restoredPrevious = false;
  try {
    await mkdir(dirname(candidateDirectory), { recursive: true, mode: 0o700 });
    await cp(entryDirectory, temporary, {
      recursive: true,
      dereference: false,
      force: true,
      preserveTimestamps: true,
    });
    const copied = await requiredArtifact(temporary, validate);
    if (copied.buildIdentity !== expected.buildIdentity)
      throw new Error("native cache candidate changed during materialization");
    if (await pathExists(candidateDirectory)) {
      await rename(candidateDirectory, backup);
      movedPrevious = true;
    }
    await rename(temporary, candidateDirectory);
    candidateInstalled = true;
  } catch (error) {
    if (movedPrevious && !candidateInstalled && !(await pathExists(candidateDirectory))) {
      try {
        await rename(backup, candidateDirectory);
        restoredPrevious = true;
      } catch {
        // Preserve the backup directory for manual recovery if restoring it also fails.
      }
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (candidateInstalled || restoredPrevious) await rm(backup, { recursive: true, force: true });
  }
}

async function withNativeBuildLock<T>(
  cacheRoot: string,
  target: string,
  cacheKey: string,
  report: (message: string) => void,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = join(cacheRoot, "build.sqlite");
  const db = new Database(lockPath, { create: true, strict: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let locked = false;
  let waiting = false;
  try {
    db.exec("PRAGMA busy_timeout = 0");
    while (!locked) {
      try {
        db.exec("BEGIN IMMEDIATE");
        locked = true;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "SQLITE_BUSY")
          throw error;
        if (!waiting) {
          report(`native: waiting for shared build ${target} ${shortKey(cacheKey)}`);
          waiting = true;
        }
        if (Date.now() >= deadline)
          throw new Error("native build cache lock timed out", { cause: error });
        await Bun.sleep(100);
      }
    }
    return await run();
  } finally {
    if (locked) db.exec("ROLLBACK");
    db.close();
  }
}

async function validArtifact(
  directory: string,
  validate: (manifest: NativeArtifactManifest) => void,
): Promise<NativeArtifactManifest | undefined> {
  try {
    return await requiredArtifact(directory, validate);
  } catch {
    return undefined;
  }
}

async function requiredArtifact(
  directory: string,
  validate: (manifest: NativeArtifactManifest) => void,
): Promise<NativeArtifactManifest> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("native artifact directory is not a regular directory");
  const manifest = await verifyNativeArtifact(directory);
  validate(manifest);
  return manifest;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid !== undefined && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error("native build cache directory is not private");
  }
}

function assertCacheAddress(target: string, cacheKey: string): void {
  if (!TARGET.test(target)) throw new Error("native build cache target is invalid");
  if (!CACHE_KEY.test(cacheKey)) throw new Error("native build cache key is invalid");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

function shortKey(cacheKey: string): string {
  return cacheKey.slice(0, 12);
}
