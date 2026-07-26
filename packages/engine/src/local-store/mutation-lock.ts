import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";

import { StoreBusyError } from "./errors";
import type { StorageRoot } from "./types";

const LOCK_FILE = "mutation.lock";
const RETRY_DELAY_MS = 10;
const MAX_ATTEMPTS = 500;

export async function withMutationLock<T>(
  root: StorageRoot,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = join(root.path, LOCK_FILE);
  const handle = await acquireMutationLock(root, lockPath);
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function acquireMutationLock(
  root: StorageRoot,
  lockPath: string,
  attempt = 0,
): Promise<Awaited<ReturnType<typeof open>>> {
  await mkdir(root.path, { recursive: true });
  try {
    return await open(lockPath, "wx");
  } catch (error: unknown) {
    if (!isNodeError(error, "EEXIST")) throw error;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      throw new StoreBusyError(lockPath);
    }
    await delay(RETRY_DELAY_MS);
    return acquireMutationLock(root, lockPath, attempt + 1);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
