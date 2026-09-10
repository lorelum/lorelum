import { open, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { assertPrivateFile, hasCode } from "./runtime-state";

/** Lifecycle events only; no request data, credentials, or provider output. */
export async function logEvent(
  directory: string,
  event: "ready" | "stopped" | "failed",
  code?: string,
): Promise<void> {
  const path = join(directory, "backend.log");
  await assertPrivateFile(path);
  try {
    if ((await stat(path)).size >= 65_536) {
      await assertPrivateFile(`${path}.1`);
      await rename(path, `${path}.1`);
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const file = await open(path, "a", 0o600);
  try {
    await file.writeFile(
      JSON.stringify({ time: new Date().toISOString(), event, ...(code ? { code } : {}) }) + "\n",
    );
  } finally {
    await file.close();
  }
}
