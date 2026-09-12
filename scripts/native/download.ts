import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename } from "node:path";

export interface PinnedDownload {
  readonly url: string;
  readonly destination: string;
  readonly sha256: string;
  readonly bytes?: number;
}

/** Download a pinned build input only when no verified local copy is available. */
export async function ensurePinnedDownload(input: PinnedDownload): Promise<void> {
  if (!existsSync(input.destination) || sha256File(input.destination) !== input.sha256) {
    rmSync(input.destination, { force: true });
    console.log(`Downloading ${basename(input.destination)}...`);
    const response = await fetch(input.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`download failed (${response.status}) for ${input.url}`);
    await Bun.write(input.destination, await response.arrayBuffer());
  }
  const actualSha256 = sha256File(input.destination);
  const actualBytes = statSync(input.destination).size;
  if (actualSha256 !== input.sha256 || (input.bytes !== undefined && actualBytes !== input.bytes)) {
    throw new Error(
      `artifact verification failed for ${input.destination}: bytes=${actualBytes}, sha256=${actualSha256}`,
    );
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
