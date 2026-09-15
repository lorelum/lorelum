import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LEASES_DIRECTORY = "leases";
const PRUNING_DIRECTORY = ".pruning";
const LEASE_WAIT_MS = 5_000;

interface LeaseRecord {
  readonly pid: number;
  readonly startedAt: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function activeLeaseCount(artifactDirectory: string): Promise<number> {
  const directory = join(artifactDirectory, LEASES_DIRECTORY);
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    // An unreadable lease directory is treated as active. Prune must never
    // convert a permissions or filesystem race into deleting a live artifact.
    return 1;
  }
  let active = 0;
  for (const entry of entries) {
    const path = join(directory, entry, "record.json");
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        typeof value !== "object" ||
        value === null ||
        !("pid" in value) ||
        typeof value.pid !== "number" ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0
      ) {
        active += 1;
        continue;
      }
      if (isProcessAlive(value.pid)) {
        active += 1;
      } else {
        await rm(join(directory, entry), { recursive: true, force: true }).catch(() => undefined);
      }
    } catch {
      active += 1;
    }
  }
  return active;
}

/**
 * Keep a content-addressed artifact alive while it is read or built. A pruner
 * first publishes its guard, so a new reader either acquires a visible lease
 * or waits for pruning to finish; it cannot race an unlink after observing a
 * ready index file.
 */
export async function withProjectArtifactLease<T>(
  artifactDirectory: string,
  work: () => Promise<T>,
): Promise<T> {
  const leases = join(artifactDirectory, LEASES_DIRECTORY);
  const pruning = join(artifactDirectory, PRUNING_DIRECTORY);
  const deadline = Date.now() + LEASE_WAIT_MS;
  while (true) {
    if (await exists(pruning)) {
      if (Date.now() >= deadline) throw new Error("Project cache artifact is being pruned");
      // eslint-disable-next-line no-await-in-loop -- bounded coordination retry.
      await Bun.sleep(25);
      continue;
    }
    await mkdir(leases, { recursive: true });
    const name = randomUUID();
    const lease = join(leases, name);
    try {
      await mkdir(lease, { recursive: false });
      const record: LeaseRecord = { pid: process.pid, startedAt: new Date().toISOString() };
      await writeFile(join(lease, "record.json"), JSON.stringify(record), { flag: "wx" });
    } catch (error) {
      await rm(lease, { recursive: true, force: true }).catch(() => undefined);
      if (Date.now() >= deadline) throw error;
      // eslint-disable-next-line no-await-in-loop -- bounded coordination retry.
      await Bun.sleep(25);
      continue;
    }
    if (!(await exists(pruning))) {
      try {
        return await work();
      } finally {
        await rm(lease, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    await rm(lease, { recursive: true, force: true }).catch(() => undefined);
    if (Date.now() >= deadline) throw new Error("Project cache artifact is being pruned");
  }
}

/** Run a destructive cache action only when no build or partial query holds the artifact. */
export async function withProjectArtifactPruneGuard<T>(
  artifactDirectory: string,
  work: () => Promise<T>,
): Promise<{ readonly pruned: true; readonly value: T } | { readonly pruned: false }> {
  const pruning = join(artifactDirectory, PRUNING_DIRECTORY);
  try {
    await mkdir(pruning);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      return { pruned: false };
    }
    throw error;
  }
  try {
    if ((await activeLeaseCount(artifactDirectory)) > 0) return { pruned: false };
    return { pruned: true, value: await work() };
  } finally {
    await rm(pruning, { recursive: true, force: true }).catch(() => undefined);
  }
}
