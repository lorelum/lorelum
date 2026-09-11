/* eslint-disable no-await-in-loop -- Retries resume only after the previous pipeline has closed. */
import got, { type Response } from "got";
import { createWriteStream, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  attempt: number;
}

export interface DownloadOptions {
  url: string;
  destination: string;
  bytes: number;
  signal: AbortSignal;
  connectTimeoutSeconds: number;
  stallTimeoutSeconds: number;
  maxAttempts: number;
  onProgress: (progress: DownloadProgress) => void;
}

export class DownloadError extends Error {
  constructor(readonly reason: string) {
    super(`download failed: ${reason}`);
    this.name = "DownloadError";
  }
}

/** @internal Plain HTTP is allowed only for local transport tests. */
export interface DownloadTestingOptions {
  readonly protocols?: "=http,https";
  readonly progressIntervalMs?: number;
}

const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

export async function downloadFile(
  options: DownloadOptions,
  testing: DownloadTestingOptions = {},
): Promise<void> {
  validateOptions(options);
  validateUrl(options.url, testing);
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (options.signal.aborted) throw new DownloadError("cancelled");
    const offset = await fileSize(options.destination);
    if (offset > options.bytes) throw new DownloadError("too-large");
    options.onProgress({ downloadedBytes: offset, totalBytes: options.bytes, attempt });
    if (offset === options.bytes) return;
    try {
      await transfer(options, offset, attempt, testing);
      const downloadedBytes = await fileSize(options.destination);
      options.onProgress({ downloadedBytes, totalBytes: options.bytes, attempt });
      if (downloadedBytes !== options.bytes) throw new DownloadError("incomplete");
      return;
    } catch (error) {
      const failure = classifyFailure(error, options.signal);
      if (attempt === options.maxAttempts || !isRetryable(failure.reason)) throw failure;
      try {
        await delay(Math.min(250, attempt * 50), undefined, { signal: options.signal });
      } catch {
        throw new DownloadError("cancelled");
      }
    }
  }
}

async function transfer(
  options: DownloadOptions,
  offset: number,
  attempt: number,
  testing: DownloadTestingOptions,
): Promise<void> {
  let failure: DownloadError | undefined;
  const connectionMs = options.connectTimeoutSeconds * 1000;
  const request = got.stream(options.url, {
    signal: options.signal,
    // Stream retries must use bytes actually flushed to disk, not bytes received by got.
    retry: { limit: 0 },
    throwHttpErrors: false,
    decompress: false,
    headers: { "accept-encoding": "identity", ...(offset ? { range: `bytes=${offset}-` } : {}) },
    timeout: {
      lookup: connectionMs,
      connect: connectionMs,
      secureConnect: connectionMs,
    },
    hooks: { beforeRedirect: [(redirect) => validateUrl(redirect.url, testing)] },
  });
  // Bun's socket timeout may surface as ECONNRESET; own the no-byte-growth deadline.
  const stalled = () => {
    failure = new DownloadError("stalled");
    request.destroy(failure);
  };
  let stallTimer = setTimeout(stalled, options.stallTimeoutSeconds * 1000);
  request.on("response", (response) => {
    try {
      validateResponse(response, offset, options.bytes);
    } catch (error) {
      failure = error instanceof DownloadError ? error : new DownloadError("network");
      request.destroy(failure);
    }
  });
  let received = offset;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(stalled, options.stallTimeoutSeconds * 1000);
      received += chunk.length;
      if (received > options.bytes) {
        failure = new DownloadError("too-large");
        callback(failure);
      } else callback(null, chunk);
    },
  });
  const progress = setInterval(() => {
    try {
      const downloadedBytes =
        statSync(options.destination, { throwIfNoEntry: false })?.size ?? offset;
      options.onProgress({ downloadedBytes, totalBytes: options.bytes, attempt });
    } catch {
      failure = new DownloadError("filesystem");
      request.destroy(failure);
    }
  }, testing.progressIntervalMs ?? 250);
  try {
    // Append never truncates retained bytes, including on rejected HTTP/Range responses.
    await pipeline(
      request,
      limit,
      createWriteStream(options.destination, { flags: "a", mode: 0o600 }),
    );
  } catch (error) {
    throw failure ?? error;
  } finally {
    clearInterval(progress);
    clearTimeout(stallTimer);
  }
}

function validateResponse(response: Response, offset: number, bytes: number): void {
  const status = response.statusCode;
  if (offset > 0 && (status === 200 || status === 416))
    throw new DownloadError("range-unsupported");
  if (status !== 200 && status !== 206) throw new DownloadError(`http-${status}`);
  if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")
    throw new DownloadError("range-unsupported");
  const length = response.headers["content-length"];
  if (length !== undefined && Number(length) > bytes - offset) throw new DownloadError("too-large");
  if (offset > 0 || status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(response.headers["content-range"]));
    if (
      !range ||
      Number(range[1]) !== offset ||
      Number(range[2]) !== bytes - 1 ||
      Number(range[3]) !== bytes
    )
      throw new DownloadError("range-unsupported");
  }
}

function validateUrl(value: URL | string | undefined, testing: DownloadTestingOptions): void {
  try {
    const url = new URL(String(value));
    if (
      (url.protocol !== "https:" && !(testing.protocols && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("unsupported URL");
  } catch {
    throw new DownloadError("invalid-url");
  }
}

function classifyFailure(error: unknown, signal: AbortSignal): DownloadError {
  if (signal.aborted) return new DownloadError("cancelled");
  if (error instanceof DownloadError) return error;
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    if (TRANSIENT_CODES.has(error.code)) return new DownloadError("network");
  }
  return new DownloadError("transfer");
}

function isRetryable(reason: string): boolean {
  return (
    ["network", "stalled", "incomplete", "http-408", "http-429"].includes(reason) ||
    /^http-5\d\d$/.test(reason)
  );
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw new DownloadError("filesystem");
  }
}

function validateOptions(options: DownloadOptions): void {
  if (
    !options.destination ||
    !Number.isSafeInteger(options.bytes) ||
    options.bytes < 0 ||
    !Number.isFinite(options.connectTimeoutSeconds) ||
    options.connectTimeoutSeconds <= 0 ||
    !Number.isFinite(options.stallTimeoutSeconds) ||
    options.stallTimeoutSeconds <= 0 ||
    !Number.isSafeInteger(options.maxAttempts) ||
    options.maxAttempts < 1
  )
    throw new DownloadError("invalid-options");
}
