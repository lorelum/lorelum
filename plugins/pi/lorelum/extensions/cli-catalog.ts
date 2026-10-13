import { spawn } from "node:child_process";

/** Wall-clock deadline for one `lore hook pi` invocation. */
export const PI_CATALOG_TIMEOUT_MS = 5_000;
/** Maximum stdout bytes retained before the response is treated as unusable. */
export const PI_CATALOG_STDOUT_LIMIT_BYTES = 16 * 1024;
/** Maximum stderr bytes retained for diagnostics; the rest is drained and dropped. */
export const PI_CATALOG_STDERR_LIMIT_BYTES = 8 * 1024;
/** Shared CLI Catalog budget; a larger `additionalContext` is rejected as malformed. */
export const PI_CATALOG_CONTEXT_LIMIT = 4_000;

/** Lifecycle events the Pi raw Hook ABI answers. */
export type PiCatalogEvent = "session_start" | "session_compact";

/** Why the Pi Catalog could not be read. `cancelled` is a superseded attempt, not a user-visible failure. */
export type PiCatalogFailureKind =
  | "cli-missing"
  | "cli-error"
  | "cli-unsupported"
  | "timeout"
  | "cancelled"
  | "invalid-response";

/** Successful read carries the bounded Catalog text; unavailable carries the failure kind. */
export type PiCatalogResult =
  | { readonly status: "catalog"; readonly catalog: string }
  | { readonly status: "unavailable"; readonly kind: PiCatalogFailureKind };

export interface PiCatalogRequest {
  readonly event: PiCatalogEvent;
  readonly cwd: string;
  readonly signal?: AbortSignal;
}

/**
 * The narrow child-process surface the adapter needs. Tests inject a fake so the
 * adapter's timeout, cancellation, and interleaving behavior can be driven
 * deterministically; production uses `node:child_process.spawn`.
 */
export interface CatalogChildProcess {
  readonly pid: number | undefined;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type CatalogProcessSpawner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
) => CatalogChildProcess;

/** Internal dependency injection seam for unit tests; not a Pi or Lorelum configuration surface. */
export interface PiCatalogDependencies {
  readonly spawn?: CatalogProcessSpawner;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly comSpec?: string;
  readonly timeoutMs?: number;
  readonly stdoutLimitBytes?: number;
  readonly stderrLimitBytes?: number;
  readonly runKillTree?: (pid: number, onFailure: () => void) => void;
}

const WINDOWS_SHIM_MISSING_EXIT_CODE = 9009;
// The fixed probe distinguishes a missing shim from a real CLI failure without
// relying on localized cmd.exe stderr. No caller data enters this script.
const WINDOWS_SHIM_SCRIPT = "where.exe /q lore.cmd || exit /b 9009 & lore.cmd hook pi";

const defaultSpawn: CatalogProcessSpawner = (command, args, options) =>
  spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as unknown as CatalogChildProcess;

/** Terminate the whole shim process tree, not only the outer `cmd.exe`. */
function defaultRunKillTree(pid: number, onFailure: () => void): void {
  try {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", onFailure);
    killer.once("close", (code) => {
      if (code !== 0) onFailure();
    });
  } catch {
    onFailure();
  }
}

type RunOutcome =
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
      readonly stdoutOverflow: boolean;
    }
  | { readonly kind: "spawn-error"; readonly code: string | undefined }
  | { readonly kind: "stdin-error" }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" };

interface RunParameters {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly payload: string;
  readonly spawn: CatalogProcessSpawner;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly runKillTree: (pid: number, onFailure: () => void) => void;
  /** True only for the Windows `cmd.exe` shim, whose real CLI runs as a child process. */
  readonly killTree: boolean;
}

/** A bounded accumulator that keeps draining after its retention limit is reached. */
function createCollector(limitBytes: number) {
  const chunks: Buffer[] = [];
  let length = 0;
  let overflow = false;
  return {
    push(chunk: unknown): void {
      if (overflow) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = limitBytes - length;
      if (buffer.length > remaining) {
        if (remaining > 0) {
          chunks.push(buffer.subarray(0, remaining));
          length = limitBytes;
        }
        overflow = true;
        return;
      }
      chunks.push(buffer);
      length += buffer.length;
    },
    overflow(): boolean {
      return overflow;
    },
    text(): string {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

/**
 * Run one `lore hook pi` call and settle exactly once on the first of exit,
 * spawn error, stdin error, deadline, or cancellation.
 */
function runCatalogProcess(parameters: RunParameters): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: CatalogChildProcess | undefined;

    const terminate = (): void => {
      if (settled || child === undefined) return;
      if (parameters.killTree && child.pid !== undefined) {
        parameters.runKillTree(child.pid, () => child?.kill("SIGKILL"));
        return;
      }
      child.kill("SIGKILL");
    };

    const onAbort = (): void => {
      terminate();
      finish({ kind: "cancelled" });
    };

    const finish = (outcome: RunOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      parameters.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    try {
      child = parameters.spawn(parameters.command, parameters.args, {
        cwd: parameters.cwd,
        env: parameters.env,
      });
    } catch (error) {
      finish({ kind: "spawn-error", code: errorCode(error) });
      return;
    }

    const stdout = createCollector(parameters.stdoutLimitBytes);
    const stderr = createCollector(parameters.stderrLimitBytes);
    child.stdout.on("data", (chunk: unknown) => stdout.push(chunk));
    child.stderr.on("data", (chunk: unknown) => stderr.push(chunk));

    child.once("error", (error: Error) => {
      terminate();
      finish({ kind: "spawn-error", code: errorCode(error) });
    });
    child.once("close", (code: number | null) => {
      finish({
        kind: "exit",
        code,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutOverflow: stdout.overflow(),
      });
    });
    child.stdin.on("error", () => {
      terminate();
      finish({ kind: "stdin-error" });
    });

    timer = setTimeout(() => {
      terminate();
      finish({ kind: "timeout" });
    }, parameters.timeoutMs);

    if (parameters.signal?.aborted === true) {
      onAbort();
      return;
    }
    parameters.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      child.stdin.write(parameters.payload);
      child.stdin.end();
    } catch {
      terminate();
      finish({ kind: "stdin-error" });
    }
  });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

async function runWithFallback(
  parameters: RunParameters,
  dependencies: Required<Pick<PiCatalogDependencies, "platform" | "comSpec">>,
): Promise<RunOutcome> {
  const first = await runCatalogProcess(parameters);
  if (
    first.kind !== "spawn-error" ||
    first.code !== "ENOENT" ||
    dependencies.platform !== "win32"
  ) {
    return first;
  }
  const fallback = await runCatalogProcess({
    ...parameters,
    command: dependencies.comSpec,
    args: ["/d", "/s", "/c", WINDOWS_SHIM_SCRIPT],
    killTree: true,
  });
  return fallback.kind === "exit" && fallback.code === WINDOWS_SHIM_MISSING_EXIT_CODE
    ? { kind: "spawn-error", code: "ENOENT" }
    : fallback;
}

function interpretOutcome(outcome: RunOutcome): PiCatalogResult {
  switch (outcome.kind) {
    case "cancelled":
      return { status: "unavailable", kind: "cancelled" };
    case "timeout":
      return { status: "unavailable", kind: "timeout" };
    case "stdin-error":
      return { status: "unavailable", kind: "cli-error" };
    case "spawn-error":
      return {
        status: "unavailable",
        kind: outcome.code === "ENOENT" ? "cli-missing" : "cli-error",
      };
    case "exit": {
      if (outcome.code !== 0) {
        return {
          status: "unavailable",
          kind: outcome.stderr.includes("usage.invalid") ? "cli-unsupported" : "cli-error",
        };
      }
      if (outcome.stdoutOverflow) {
        return { status: "unavailable", kind: "invalid-response" };
      }
      const parsed = parsePiCatalogResponse(outcome.stdout);
      return parsed.ok
        ? { status: "catalog", catalog: parsed.catalog }
        : { status: "unavailable", kind: "invalid-response" };
    }
  }
}

/**
 * Validate the flat Pi Extension/CLI adapter envelope. `{}` means unavailable,
 * not an empty Store, so a missing or oversized `additionalContext` is rejected.
 */
export function parsePiCatalogResponse(
  raw: string,
): { readonly ok: true; readonly catalog: string } | { readonly ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }
  const context = (parsed as Record<string, unknown>).additionalContext;
  if (
    typeof context !== "string" ||
    context.length === 0 ||
    context.length > PI_CATALOG_CONTEXT_LIMIT
  ) {
    return { ok: false };
  }
  return { ok: true, catalog: context };
}

/**
 * Read the Installed Pack Catalog through the `lore hook pi` raw ABI. The result
 * is always a discriminated outcome: a missing or failing CLI degrades to
 * `unavailable` and never throws into the Pi lifecycle.
 */
export async function readPiCatalog(
  request: PiCatalogRequest,
  dependencies: PiCatalogDependencies = {},
): Promise<PiCatalogResult> {
  const platform = dependencies.platform ?? process.platform;
  const parameters: RunParameters = {
    command: "lore",
    args: ["hook", "pi"],
    cwd: request.cwd,
    env: dependencies.env ?? process.env,
    payload: JSON.stringify({ hook_event_name: request.event }),
    spawn: dependencies.spawn ?? defaultSpawn,
    signal: request.signal,
    timeoutMs: dependencies.timeoutMs ?? PI_CATALOG_TIMEOUT_MS,
    stdoutLimitBytes: dependencies.stdoutLimitBytes ?? PI_CATALOG_STDOUT_LIMIT_BYTES,
    stderrLimitBytes: dependencies.stderrLimitBytes ?? PI_CATALOG_STDERR_LIMIT_BYTES,
    runKillTree: dependencies.runKillTree ?? defaultRunKillTree,
    killTree: false,
  };
  const outcome = await runWithFallback(parameters, {
    platform,
    comSpec: dependencies.comSpec ?? process.env.ComSpec ?? "cmd.exe",
  });
  return interpretOutcome(outcome);
}
