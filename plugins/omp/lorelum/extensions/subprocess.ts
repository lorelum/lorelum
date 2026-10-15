import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { win32 } from "node:path";

export const BRIDGE_TIMEOUT_MS = 10_000;
const MAX_STDOUT_BYTES = 32_768;

export interface BridgeExecution {
  stdout: string;
  code: number | null;
}

export type BridgeRequest =
  | { event: "catalog"; agentKind: "main" | "sub" }
  | { event: "shell"; sessionId: string; command: string }
  | { event: "read-hints"; sessionId: string };

export type BridgeExecutor = (options: {
  cwd: string;
  signal: AbortSignal;
  request: BridgeRequest;
}) => Promise<BridgeExecution>;

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

/** Only the fixed Windows shim command enters cmd; the JSON request stays on stdin. */
export function bridgeCommand(platform: NodeJS.Platform, systemRoot = "C:\\Windows") {
  return platform === "win32"
    ? {
        command: win32.join(systemRoot, "System32", "cmd.exe"),
        args: ["/d", "/s", "/c", "lore.cmd hook omp"],
        windowsVerbatimArguments: true,
      }
    : { command: "lore", args: ["hook", "omp"], windowsVerbatimArguments: false };
}

/** Narrow process seam for deterministic tests; no host runtime or filesystem dependency. */
export function createBridgeExecutor(
  options: {
    spawn?: Spawn;
    platform?: NodeJS.Platform;
    systemRoot?: string;
    timeoutMs?: number;
  } = {},
): BridgeExecutor {
  const launch: Spawn =
    options.spawn ?? ((command, args, settings) => spawn(command, args, settings));
  const platform = options.platform ?? process.platform;
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
  const command = bridgeCommand(platform, systemRoot);
  return ({ cwd, signal, request }) => {
    const { promise, resolve, reject } = Promise.withResolvers<BridgeExecution>();
    if (signal.aborted) {
      reject(new Error("Lorelum bridge cancelled"));
      return promise;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = launch(command.command, command.args, {
        cwd,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: command.windowsVerbatimArguments,
      });
    } catch (error) {
      reject(error);
      return promise;
    }
    let stdout = "";
    let stdoutBytes = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const terminate = () => {
      if (platform === "win32" && child.pid !== undefined) {
        // cmd owns the CLI child; kill the tree rather than leaving the shim's child alive.
        try {
          const killer = launch(
            win32.join(systemRoot, "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { shell: false, windowsHide: true },
          );
          killer.on("error", () => {
            child.kill("SIGKILL");
          });
          killer.stdout.resume();
          killer.stderr.resume();
          killer.stdin.end();
          killer.unref();
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminate();
      reject(error);
    };
    const cancel = () => fail(new Error("Lorelum bridge cancelled"));
    const timer = setTimeout(
      () => fail(new Error("Lorelum bridge timed out")),
      options.timeoutMs ?? BRIDGE_TIMEOUT_MS,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        fail(new Error("Lorelum bridge response exceeded the output budget"));
        return;
      }
      stdout += chunk;
    });
    child.on("error", (error) => fail(error));
    child.stdin.on("error", (error) => fail(error));
    child.stdout.on("error", (error) => fail(error));
    child.stderr.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, code });
    });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else child.stdin.end(`${JSON.stringify(request)}\n`);
    return promise;
  };
}
