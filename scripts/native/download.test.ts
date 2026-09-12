import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePinnedDownload } from "./download";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test("pinned native downloads verify once and reuse the local bytes without another request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-download-"));
  const body = "pinned native input";
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests += 1;
      return new Response(body);
    },
  });
  const destination = join(directory, "input.tar.gz");
  const input = {
    url: `http://127.0.0.1:${server.port}/input.tar.gz`,
    destination,
    sha256: digest(body),
    bytes: Buffer.byteLength(body),
  };
  try {
    await ensurePinnedDownload(input);
    await server.stop(true);
    await ensurePinnedDownload(input);

    expect(requests).toBe(1);
    expect(await readFile(destination, "utf8")).toBe(body);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
