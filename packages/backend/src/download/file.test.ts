/* eslint-disable no-await-in-loop -- Local transport assertions follow observable request order. */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadError, downloadFile, type DownloadProgress } from "./file";

const directories: string[] = [];
const transport = { protocols: "=http,https" as const, progressIntervalMs: 20 };

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("resumes with Range after the first response disconnects", async () => {
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

test("cancellation closes the writer and leaves the part resumable", async () => {
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
          transport,
        ),
      ).rejects.toMatchObject({ reason: "cancelled" });
      const partialBytes = (await stat(destination)).size;
      expect(partialBytes).toBeGreaterThan(0);
      expect(partialBytes).toBeLessThan(data.length);

      await downloadFile(options(url, destination, data.length), transport);
      expect(await readFile(destination)).toEqual(data);
      expect(ranges.at(-1)).toBe(`bytes=${partialBytes}-`);
    },
  );
});

test("a server that ignores Range preserves the part and is not retried", async () => {
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

test("404 is not retried", async () => {
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

test("408, 429, and 5xx responses are retried", async () => {
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

test("a response with no transfer progress hits the stall timeout", async () => {
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

test("content larger than the expected byte limit is rejected", async () => {
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

test("slow responses that keep making progress are not stopped", async () => {
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

test("download stops with its process and resumes after restart", async () => {
  const data = Buffer.alloc(256 * 1024, "p");
  let requests = 0;
  await withServer(
    (request) => {
      requests++;
      return requests === 1 ? pacedResponse(request, data, 1024, 20) : rangeResponse(request, data);
    },
    async (url) => {
      const destination = await temporaryPart();
      const modulePath = join(import.meta.dir, "file.ts");
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
        });
      `;
      const owner = Bun.spawn([process.execPath, "-e", childScript], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      try {
        const progressDeadline = Date.now() + 2000;
        while ((await currentSize(destination)) === 0 && Date.now() < progressDeadline) {
          await Bun.sleep(20);
        }
        expect(await currentSize(destination)).toBeGreaterThan(0);
        owner.kill("SIGKILL");
        await owner.exited;

        await downloadFile(options(url, destination, data.length), transport);
        const completed = await readFile(destination);
        expect(completed.length).toBe(data.length);
        expect(createHash("sha256").update(completed).digest("hex")).toBe(
          createHash("sha256").update(data).digest("hex"),
        );
      } finally {
        owner.kill("SIGKILL");
      }
    },
  );
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
  const directory = await mkdtemp(join(tmpdir(), "lore-download-"));
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

async function currentSize(path: string): Promise<number> {
  return (await stat(path).catch(() => undefined))?.size ?? 0;
}

test("errors never expose the URL", () => {
  const error = new DownloadError("network");
  expect(error.message).toBe("download failed: network");
});

for (const range of ["bytes 0-19/20", "bytes 5-18/20", "bytes 5-19/21", "invalid"]) {
  test(`invalid Content-Range preserves the partial file: ${range}`, async () => {
    const partial = Buffer.from("first");
    await withServer(
      () => new Response(Buffer.alloc(15), { status: 206, headers: { "content-range": range } }),
      async (url) => {
        const destination = await temporaryPart();
        await writeFile(destination, partial);
        await expect(downloadFile(options(url, destination, 20), transport)).rejects.toMatchObject({
          reason: "range-unsupported",
        });
        expect(await readFile(destination)).toEqual(partial);
      },
    );
  });
}

test("chunked oversized responses never write past the byte limit", async () => {
  await withServer(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.alloc(64));
            controller.close();
          },
        }),
      ),
    async (url) => {
      const destination = await temporaryPart();
      await expect(downloadFile(options(url, destination, 32), transport)).rejects.toMatchObject({
        reason: "too-large",
      });
      expect(await currentSize(destination)).toBeLessThanOrEqual(32);
    },
  );
});

test("production rejects plain HTTP without making a request", async () => {
  let requests = 0;
  await withServer(
    () => {
      requests++;
      return new Response("ignored");
    },
    async (url) => {
      await expect(downloadFile(options(url, await temporaryPart(), 7))).rejects.toMatchObject({
        reason: "invalid-url",
      });
      expect(requests).toBe(0);
    },
  );
});

test("redirected downloads retain the Range contract", async () => {
  const data = Buffer.from("redirected range response");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/model")
        return Response.redirect(new URL("/file", request.url).href);
      return rangeResponse(request, data);
    },
  });
  try {
    const destination = await temporaryPart();
    await writeFile(destination, data.subarray(0, 5));
    await downloadFile(
      options(`http://127.0.0.1:${server.port}/model`, destination, data.length),
      transport,
    );
    expect(await readFile(destination)).toEqual(data);
  } finally {
    await server.stop(true);
  }
});

test("cancelled transfers cannot append more bytes after rejection", async () => {
  const data = Buffer.alloc(64 * 1024);
  await withServer(
    (request) => pacedResponse(request, data, 1024, 20),
    async (url) => {
      const destination = await temporaryPart();
      const abort = new AbortController();
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
          transport,
        ),
      ).rejects.toMatchObject({ reason: "cancelled" });
      const size = await currentSize(destination);
      await Bun.sleep(100);
      expect(await currentSize(destination)).toBe(size);
    },
  );
});
