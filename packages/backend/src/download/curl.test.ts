/* eslint-disable no-await-in-loop -- Local transport assertions follow observable request order. */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processIdentity } from "../runtime/process-identity";
import { DownloadError, downloadFile, waitForDownloadExit, type DownloadProgress } from "./curl";
import { ownerPath, writeOwner } from "./owner";

const directories: string[] = [];
const transport = { protocols: "=http,https" as const, progressIntervalMs: 20 };
const macTest = process.platform === "darwin" && process.arch === "arm64" ? test : test.skip;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

macTest("resumes with Range after the first response disconnects", async () => {
  const data = Buffer.alloc(64 * 1024, "r");
  const ranges: (string | null)[] = [];
  let requests = 0;
  await withServer(
    async (request) => {
      requests++;
      ranges.push(request.headers.get("range"));
      if (requests === 1) return disconnectingResponse(data);
      return rangeResponse(request, data);
    },
    async (url) => {
      const destination = await temporaryPart();
      const progress: DownloadProgress[] = [];
      await downloadFile(
        options(url, destination, data.length, (value) => progress.push(value)),
        transport,
      );
      expect(await readFile(destination)).toEqual(data);
      expect(requests).toBe(2);
      expect(ranges[0]).toBeNull();
      expect(ranges[1]).toMatch(/^bytes=[1-9]\d*-$/);
      expect(progress.some((value) => value.attempt === 2 && value.downloadedBytes > 0)).toBeTrue();
    },
  );
});

macTest("cancellation leaves the part resumable and no curl process behind", async () => {
  const data = Buffer.alloc(128 * 1024, "c");
  const ranges: (string | null)[] = [];
  await withServer(
    async (request) => {
      ranges.push(request.headers.get("range"));
      if (ranges.length === 1) return pacedResponse(request, data, 1024, 30);
      return rangeResponse(request, data);
    },
    async (url) => {
      const destination = await temporaryPart();
      const abort = new AbortController();
      let curlPid = 0;
      await expect(
        downloadFile(
          options(
            url,
            destination,
            data.length,
            (progress) => {
              if (progress.downloadedBytes > 0) abort.abort();
            },
            abort.signal,
          ),
          { ...transport, onCurlSpawn: (pid) => (curlPid = pid) },
        ),
      ).rejects.toMatchObject({ reason: "cancelled" });
      const partialBytes = (await stat(destination)).size;
      expect(partialBytes).toBeGreaterThan(0);
      expect(partialBytes).toBeLessThan(data.length);
      expect(processExists(curlPid)).toBeFalse();

      await downloadFile(options(url, destination, data.length), transport);
      expect(await readFile(destination)).toEqual(data);
      expect(ranges.at(-1)).toBe(`bytes=${partialBytes}-`);
    },
  );
});

macTest("a server that ignores Range preserves the part and is not retried", async () => {
  const data = Buffer.from("range must be honored");
  let requests = 0;
  await withServer(
    () => {
      requests++;
      return new Response(data, { headers: { "content-length": String(data.length) } });
    },
    async (url) => {
      const destination = await temporaryPart();
      const partial = data.subarray(0, 5);
      await writeFile(destination, partial);
      await expect(
        downloadFile(options(url, destination, data.length, undefined, undefined, 3), transport),
      ).rejects.toMatchObject({ reason: "range-unsupported" });
      expect(await readFile(destination)).toEqual(partial);
      expect(requests).toBe(1);
    },
  );
});

macTest("404 is not retried", async () => {
  let requests = 0;
  await withServer(
    () => {
      requests++;
      return new Response("missing", { status: 404 });
    },
    async (url) => {
      await expect(
        downloadFile(options(url, await temporaryPart(), 20, undefined, undefined, 4), transport),
      ).rejects.toMatchObject({ reason: "http-404" });
      expect(requests).toBe(1);
    },
  );
});

macTest("408, 429, and 5xx responses are retried", async () => {
  const data = Buffer.from("transient response recovered");
  const statuses = [408, 429, 503];
  let requests = 0;
  await withServer(
    () => {
      const status = statuses[requests++];
      return status === undefined
        ? new Response(data, { headers: { "content-length": String(data.length) } })
        : new Response("retry", { status });
    },
    async (url) => {
      const destination = await temporaryPart();
      await downloadFile(
        options(url, destination, data.length, undefined, undefined, 4),
        transport,
      );
      expect(await readFile(destination)).toEqual(data);
      expect(requests).toBe(4);
    },
  );
});

macTest("a response with no transfer progress hits the stall timeout", async () => {
  await withServer(
    (request) => stalledResponse(request, 32),
    async (url) => {
      const started = Date.now();
      await expect(
        downloadFile(
          { ...options(url, await temporaryPart(), 32), stallTimeoutSeconds: 1 },
          transport,
        ),
      ).rejects.toMatchObject({ reason: "stalled" });
      expect(Date.now() - started).toBeLessThan(5_000);
    },
  );
});

macTest("content larger than the expected byte limit is rejected", async () => {
  const data = Buffer.alloc(64, "x");
  await withServer(
    () => new Response(data, { headers: { "content-length": String(data.length) } }),
    async (url) => {
      const destination = await temporaryPart();
      await expect(downloadFile(options(url, destination, 32), transport)).rejects.toMatchObject({
        reason: "too-large",
      });
      expect(await currentSize(destination)).toBeLessThanOrEqual(32);
    },
  );
});

macTest("slow responses that keep making progress are not stopped", async () => {
  const data = Buffer.from("slow-but-live");
  await withServer(
    (request) => pacedResponse(request, data, 1, 300),
    async (url) => {
      const destination = await temporaryPart();
      await downloadFile(
        { ...options(url, destination, data.length), stallTimeoutSeconds: 1 },
        transport,
      );
      expect(await readFile(destination)).toEqual(data);
    },
  );
});

macTest("curl exits and stops writing when its Bun parent is killed", async () => {
  const data = Buffer.alloc(256 * 1024, "p");
  let requests = 0;
  await withServer(
    (request) => {
      requests++;
      return requests === 1 ? pacedResponse(request, data, 1024, 20) : rangeResponse(request, data);
    },
    async (url) => {
      const destination = await temporaryPart();
      const modulePath = join(import.meta.dir, "curl.ts");
      const childScript = `
        import { downloadFile } from ${JSON.stringify(modulePath)};
        await downloadFile({
          url: ${JSON.stringify(url)},
          destination: ${JSON.stringify(destination)},
          bytes: ${data.length},
          signal: new AbortController().signal,
          connectTimeoutSeconds: 1,
          stallTimeoutSeconds: 2,
          maxAttempts: 1,
          onProgress() {},
        }, {
          protocols: "=http,https",
          progressIntervalMs: 20,
          onCurlSpawn(pid) { console.log("curl:" + pid); },
        });
      `;
      const owner = Bun.spawn([process.execPath, "-e", childScript], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      let curlPid = 0;
      try {
        curlPid = await readCurlPid(owner.stdout);
        const progressDeadline = Date.now() + 2000;
        while ((await currentSize(destination)) === 0 && Date.now() < progressDeadline) {
          await Bun.sleep(20);
        }
        expect(await currentSize(destination)).toBeGreaterThan(0);
        const ownerInfo = await stat(ownerPath(destination));
        expect(ownerInfo.mode & 0o077).toBe(0);
        owner.kill("SIGKILL");
        await owner.exited;

        let oldOwnerExitedBeforeNewCurl = false;
        await downloadFile(options(url, destination, data.length), {
          ...transport,
          onCurlSpawn: () => {
            oldOwnerExitedBeforeNewCurl = !processExists(curlPid);
          },
        });
        expect(oldOwnerExitedBeforeNewCurl).toBeTrue();
        expect(processExists(curlPid)).toBeFalse();
        const completed = await readFile(destination);
        expect(completed.length).toBe(data.length);
        expect(createHash("sha256").update(completed).digest("hex")).toBe(
          createHash("sha256").update(data).digest("hex"),
        );
        expect(await stat(ownerPath(destination)).catch(() => undefined)).toBeUndefined();
      } finally {
        owner.kill("SIGKILL");
        if (processExists(curlPid)) process.kill(curlPid, "SIGKILL");
      }
    },
  );
});

macTest("waiting for an old owner supports cancellation without killing it", async () => {
  const destination = await temporaryPart();
  const identity = await processIdentity(process.pid);
  expect(identity).toBeDefined();
  if (identity === undefined) throw new Error("current process identity is unavailable");
  await writeOwner(destination, identity);
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 50);
  await expect(waitForDownloadExit(destination, abort.signal)).rejects.toMatchObject({
    reason: "cancelled",
  });
  expect(processExists(process.pid)).toBeTrue();
  expect(await stat(ownerPath(destination))).toBeDefined();
});

function options(
  url: string,
  destination: string,
  bytes: number,
  onProgress: ((progress: DownloadProgress) => void) | undefined = undefined,
  signal: AbortSignal | undefined = undefined,
  maxAttempts = 2,
) {
  return {
    url,
    destination,
    bytes,
    signal: signal ?? new AbortController().signal,
    connectTimeoutSeconds: 1,
    stallTimeoutSeconds: 1,
    maxAttempts,
    onProgress: onProgress ?? (() => {}),
  };
}

async function temporaryPart(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lore-curl-"));
  directories.push(directory);
  return join(directory, "model.part");
}

async function withServer(
  fetch: (request: Request) => Response | Promise<Response>,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  try {
    await run(`http://127.0.0.1:${server.port}/model`);
  } finally {
    await server.stop(true);
  }
}

function rangeResponse(request: Request, data: Buffer): Response {
  const range = request.headers.get("range");
  if (!range) return new Response(data, { headers: { "content-length": String(data.length) } });
  const offset = Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= data.length) {
    return new Response(null, { status: 416 });
  }
  return new Response(data.subarray(offset), {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(data.length - offset),
      "content-range": `bytes ${offset}-${data.length - 1}/${data.length}`,
    },
  });
}

function disconnectingResponse(data: Buffer): Response {
  return new Response(data.subarray(0, data.length / 2), {
    headers: { "content-length": String(data.length) },
  });
}

function pacedResponse(
  request: Request,
  data: Buffer,
  chunkBytes: number,
  intervalMs: number,
): Response {
  const range = request.headers.get("range");
  const offset = range ? Number(/^bytes=(\d+)-$/.exec(range)?.[1]) : 0;
  let cursor = offset;
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream({
    start(controller) {
      timer = setInterval(() => {
        if (cursor >= data.length) {
          clearInterval(timer);
          controller.close();
          return;
        }
        const end = Math.min(cursor + chunkBytes, data.length);
        controller.enqueue(data.subarray(cursor, end));
        cursor = end;
      }, intervalMs);
      request.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(data.length - offset),
      ...(range ? { "content-range": `bytes ${offset}-${data.length - 1}/${data.length}` } : {}),
    },
  });
}

function stalledResponse(request: Request, bytes: number): Response {
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream({
    start() {
      timer = setInterval(() => {}, 1000);
      request.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, { headers: { "content-length": String(bytes) } });
}

function processExists(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function currentSize(path: string): Promise<number> {
  return (await stat(path).catch(() => undefined))?.size ?? 0;
}

async function readCurlPid(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const reading = (async () => {
    while (true) {
      const result = await reader.read();
      if (result.done) throw new Error("download parent exited before reporting curl pid");
      output += decoder.decode(result.value, { stream: true });
      const value = /(?:^|\n)curl:(\d+)(?:\n|$)/.exec(output)?.[1];
      if (value) return Number(value);
    }
  })();
  return await Promise.race([
    reading,
    Bun.sleep(3000).then(() => {
      throw new Error("timed out waiting for curl pid");
    }),
  ]);
}

test("errors never expose the URL", () => {
  const error = new DownloadError("network");
  expect(error.message).toBe("download failed: network");
});
