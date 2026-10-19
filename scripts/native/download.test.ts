import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("a cached digest mismatch replaces the invalid bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-download-"));
  const destination = join(directory, "input.tar.gz");
  const body = "pinned native input";
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests += 1;
      return new Response(body);
    },
  });
  try {
    await writeFile(destination, "corrupted native input");
    await ensurePinnedDownload({
      url: `http://127.0.0.1:${server.port}/input.tar.gz`,
      destination,
      sha256: digest(body),
      bytes: Buffer.byteLength(body),
    });
    expect(requests).toBe(1);
    expect(await readFile(destination, "utf8")).toBe(body);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a valid cached digest still rejects an incorrect pinned size without downloading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-download-"));
  const destination = join(directory, "input.tar.gz");
  const body = "pinned native input";
  try {
    await writeFile(destination, body);
    await expect(
      ensurePinnedDownload({
        url: "https://invalid.invalid/input.tar.gz",
        destination,
        sha256: digest(body),
        bytes: Buffer.byteLength(body) + 1,
      }),
    ).rejects.toThrow("artifact verification failed");
    expect(await readFile(destination, "utf8")).toBe(body);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["sha256", "bytes"] as const)(
  "downloaded bytes must satisfy the pinned %s",
  async (invalidField) => {
    const directory = await mkdtemp(join(tmpdir(), "lore-native-download-"));
    const body = "pinned native input";
    const server = Bun.serve({ port: 0, fetch: () => new Response(body) });
    try {
      await expect(
        ensurePinnedDownload({
          url: `http://127.0.0.1:${server.port}/input.tar.gz`,
          destination: join(directory, "input.tar.gz"),
          sha256: digest(invalidField === "sha256" ? "different input" : body),
          bytes: Buffer.byteLength(body) + (invalidField === "bytes" ? 1 : 0),
        }),
      ).rejects.toThrow("artifact verification failed");
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
