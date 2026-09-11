/* eslint-disable no-await-in-loop -- Poll observable process state until a bounded deadline. */
import assert from "node:assert/strict";
import { isSameProcess, type ProcessIdentity } from "../../src/runtime/process-identity";

export async function waitUntil(
  description: string,
  condition: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    assert(Date.now() < deadline, `Timed out waiting for ${description}`);
    await Bun.sleep(20);
  }
}

export function waitForProcessExit(identity: ProcessIdentity): Promise<void> {
  return waitUntil(`process ${identity.pid} to exit`, async () => !(await isSameProcess(identity)));
}

export async function readRssMiB(identity: ProcessIdentity): Promise<number> {
  assert(await isSameProcess(identity), "RSS sample requires the recorded live process");
  const ps = Bun.spawn(["/bin/ps", "-o", "rss=", "-p", String(identity.pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const rss = Number((await new Response(ps.stdout).text()).trim());
  assert.equal(await ps.exited, 0, "ps must successfully read native RSS");
  assert(Number.isFinite(rss) && rss > 0, "Native RSS must be finite and positive");
  return rss / 1024;
}
