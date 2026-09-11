/* eslint-disable no-await-in-loop -- Attempts and process cleanup are deliberately sequential. */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  clearOwner,
  DownloadOwnerError,
  identifyOwner,
  waitForDownloadExit,
  writeOwner,
} from "./owner";
import type { ProcessIdentity } from "../runtime/process-identity";

export { waitForDownloadExit } from "./owner";

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

/** @internal Test-only transport overrides. Production callers use the one-argument overload. */
export interface DownloadTestingOptions {
  readonly protocols?: "=http,https";
  readonly progressIntervalMs?: number;
  readonly onCurlSpawn?: (pid: number) => void;
}

interface AttemptResult {
  readonly exitCode: number | null;
  readonly httpStatus: number;
}

const CURL = "/usr/bin/curl";
const SHELL = "/bin/sh";
const RETRYABLE_CURL_CODES = new Set([5, 6, 7, 18, 28, 35, 52, 55, 56, 92]);
const RANGE_UNSUPPORTED_CODES = new Set([33, 36]);
const GUARDIAN = `
exec 3<&0
IFS= read -r grant <&3 || exit 0
[ "$grant" = "grant" ] || exit 0
"$@" &
curl_pid=$!
printf 'pid:%s\\n' "$curl_pid"
(
  while IFS= read -r ignored; do :; done
  kill -TERM "$curl_pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$curl_pid" 2>/dev/null || true
) <&3 &
watcher_pid=$!
wait "$curl_pid"
status=$?
kill "$watcher_pid" 2>/dev/null || true
wait "$watcher_pid" 2>/dev/null || true
exit "$status"
`;

export function downloadFile(options: DownloadOptions): Promise<void>;
/** @internal */
export function downloadFile(
  options: DownloadOptions,
  testing: DownloadTestingOptions,
): Promise<void>;
export async function downloadFile(
  options: DownloadOptions,
  testing: DownloadTestingOptions = {},
): Promise<void> {
  validateOptions(options);
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new DownloadError("unsupported-platform");
  }

  try {
    await waitForDownloadExit(options.destination, options.signal);
  } catch (error) {
    throw ownerError(error);
  }
  let currentBytes = await fileSize(options.destination);
  if (currentBytes > options.bytes) throw new DownloadError("too-large");
  if (currentBytes === options.bytes) {
    options.onProgress({ downloadedBytes: currentBytes, totalBytes: options.bytes, attempt: 1 });
    return;
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (options.signal.aborted) throw new DownloadError("cancelled");
    if (attempt > 1) {
      try {
        await waitForDownloadExit(options.destination, options.signal);
      } catch (error) {
        throw ownerError(error);
      }
      currentBytes = await fileSize(options.destination);
    }
    options.onProgress({ downloadedBytes: currentBytes, totalBytes: options.bytes, attempt });

    const result = await runAttempt(options, attempt, testing);
    currentBytes = await fileSize(options.destination);
    if (currentBytes > options.bytes) throw new DownloadError("too-large");
    options.onProgress({ downloadedBytes: currentBytes, totalBytes: options.bytes, attempt });

    if (options.signal.aborted) throw new DownloadError("cancelled");
    if (result.exitCode === 0 && currentBytes === options.bytes) return;

    const decision = classifyFailure(result, currentBytes, options.bytes);
    if (!decision.retry || attempt === options.maxAttempts) {
      throw new DownloadError(decision.reason);
    }
    try {
      await delay(Math.min(250, attempt * 50), undefined, { signal: options.signal });
    } catch {
      throw new DownloadError("cancelled");
    }
  }
}

async function runAttempt(
  options: DownloadOptions,
  attempt: number,
  testing: DownloadTestingOptions,
): Promise<AttemptResult> {
  const protocols = testing.protocols ?? "=https";
  const curlArguments = [
    "-q",
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--continue-at",
    "-",
    "--output",
    options.destination,
    "--proto",
    protocols,
    "--proto-redir",
    protocols,
    "--connect-timeout",
    String(options.connectTimeoutSeconds),
    "--speed-limit",
    "1",
    "--speed-time",
    String(options.stallTimeoutSeconds),
    "--max-filesize",
    String(options.bytes),
    "--write-out",
    "\\nhttp:%{http_code}\\n",
    options.url,
  ];
  const child = spawn(SHELL, ["-c", GUARDIAN, "lorelum-curl", CURL, ...curlArguments], {
    stdio: ["pipe", "pipe", "ignore"],
    env: { PATH: "/usr/bin:/bin" },
  });
  const started = new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));

  let curlPid: number | undefined;
  let owner: ProcessIdentity | undefined;
  let httpStatus = 0;
  let output = "";
  let progressFailure: unknown;
  const parseOutput = (chunk: Buffer) => {
    output += chunk.toString("utf8");
    const pid = /(?:^|\n)pid:(\d+)(?:\n|$)/.exec(output)?.[1];
    if (pid && curlPid === undefined) {
      curlPid = Number(pid);
      testing.onCurlSpawn?.(curlPid);
    }
    const status = /(?:^|\n)http:(\d{3})(?:\n|$)/.exec(output)?.[1];
    if (status) httpStatus = Number(status);
    if (output.length > 1024) output = output.slice(-1024);
  };
  child.stdout.on("data", parseOutput);

  const stop = () => child.stdin.end();
  child.stdin.on("error", () => {});
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  const interval = setInterval(() => {
    try {
      const downloadedBytes = statSync(options.destination, { throwIfNoEntry: false })?.size ?? 0;
      if (downloadedBytes > options.bytes) {
        progressFailure = new DownloadError("too-large");
        stop();
        return;
      }
      options.onProgress({ downloadedBytes, totalBytes: options.bytes, attempt });
    } catch (error) {
      progressFailure = error;
      stop();
    }
  }, testing.progressIntervalMs ?? 250);

  let exitCode: number | null = null;
  let failure: DownloadError | undefined;
  try {
    await started;
    if (child.pid === undefined) throw new DownloadError("process");
    if (options.signal.aborted) throw new DownloadError("cancelled");
    owner = await identifyOwner(child.pid);
    await writeOwner(options.destination, owner);
    if (options.signal.aborted) throw new DownloadError("cancelled");
    await new Promise<void>((resolve, reject) => {
      child.stdin.write("grant\n", (error) => (error ? reject(error) : resolve()));
    });
    exitCode = await closed;
    if (progressFailure instanceof DownloadError) throw progressFailure;
    if (progressFailure !== undefined) throw new DownloadError("filesystem");
  } catch (error) {
    failure = options.signal.aborted
      ? new DownloadError("cancelled")
      : error instanceof DownloadError
        ? error
        : error instanceof DownloadOwnerError
          ? ownerError(error)
          : new DownloadError("process");
  } finally {
    clearInterval(interval);
    options.signal.removeEventListener("abort", stop);
    stop();
    // The guardian owns TERM/KILL and reaps curl. Keep preparation pending until
    // it really closes; service.unload owns the deadline and retains failed work.
    await closed;
    child.stdin.destroy();
    if (owner !== undefined) {
      try {
        await clearOwner(options.destination, owner);
      } catch (error) {
        failure ??= ownerError(error);
      }
    }
  }
  if (failure !== undefined) throw failure;
  return { exitCode, httpStatus };
}

function classifyFailure(
  result: AttemptResult,
  downloadedBytes: number,
  expectedBytes: number,
): { readonly retry: boolean; readonly reason: string } {
  if (result.exitCode === 63 || downloadedBytes > expectedBytes) {
    return { retry: false, reason: "too-large" };
  }
  if (result.exitCode !== null && RANGE_UNSUPPORTED_CODES.has(result.exitCode)) {
    return { retry: false, reason: "range-unsupported" };
  }
  if (result.exitCode === 22) {
    const retry =
      result.httpStatus === 408 || result.httpStatus === 429 || result.httpStatus >= 500;
    return { retry, reason: `http-${result.httpStatus || "error"}` };
  }
  if (result.exitCode !== null && RETRYABLE_CURL_CODES.has(result.exitCode)) {
    return { retry: true, reason: result.exitCode === 28 ? "stalled" : "network" };
  }
  if (result.exitCode === 0 && downloadedBytes !== expectedBytes) {
    return { retry: true, reason: "incomplete" };
  }
  return { retry: false, reason: "process" };
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
    !options.url ||
    !options.destination ||
    !Number.isSafeInteger(options.bytes) ||
    options.bytes < 0 ||
    !Number.isFinite(options.connectTimeoutSeconds) ||
    options.connectTimeoutSeconds <= 0 ||
    !Number.isFinite(options.stallTimeoutSeconds) ||
    options.stallTimeoutSeconds <= 0 ||
    !Number.isSafeInteger(options.maxAttempts) ||
    options.maxAttempts < 1
  ) {
    throw new DownloadError("invalid-options");
  }
}

function ownerError(error: unknown): DownloadError {
  if (error instanceof DownloadOwnerError) return new DownloadError(error.reason);
  return new DownloadError("owner-state");
}
