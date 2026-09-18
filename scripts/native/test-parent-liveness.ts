import buildConfig from "../../native/embedding/build-config.json";
import { llamaArguments } from "../../packages/backend/src/runtime/llama-options";
import {
  developmentEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import { win32NativeToolchain } from "./win32-toolchain";
/* eslint-disable no-await-in-loop -- Lifecycle states and process exits must be observed sequentially. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { materializePatchedLlamaSource } from "./source-tree";

type TestMode = "startup" | "encoding" | "stalled-main" | "direct-version";

const repositoryRoot = resolve(import.meta.dir, "../..");
const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
if (artifact === undefined)
  throw new Error(
    `native lifecycle tests currently support darwin-arm64, linux-x64, and win32-x64, got ${process.platform}-${process.arch}`,
  );
const executableName = artifact.manifest.executable;
const executable = join(developmentEmbeddingArtifactDirectory(artifact), executableName);
const model = join(repositoryRoot, ".cache/embedding-validation", buildConfig.model.fileName);
const harnessName =
  process.platform === "win32" ? "stalled-llama-server.exe" : "stalled-llama-server";
const harness = join(repositoryRoot, ".cache/native-liveness", harnessName);
/** Minimal child environment: no shell PATH on POSIX, only the system root on Windows. */
const childEnvironment =
  process.platform === "win32"
    ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
    : { PATH: "/usr/bin:/bin" };

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function reserveEphemeralPort(): Promise<number> {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  const port = reservation.port;
  await reservation.stop(true);
  if (port === undefined) {
    throw new Error("Bun did not allocate an ephemeral port");
  }
  return port;
}

async function ensureHarness(): Promise<void> {
  const sourceRoot = await materializePatchedLlamaSource(repositoryRoot);
  const patchedMain = join(sourceRoot, "tools/server/main.cpp");
  mkdirSync(join(repositoryRoot, ".cache/native-liveness"), { recursive: true });
  // The liveness harness links against the same patched server entrypoint it probes.
  let compiler: readonly string[] = ["c++"];
  let environment: NodeJS.ProcessEnv | undefined = undefined;
  let staticFlags: readonly string[] = [];
  if (artifact.platform === "darwin") compiler = ["xcrun", "clang++"];
  if (artifact.platform === "win32") {
    const toolchain = win32NativeToolchain(repositoryRoot);
    compiler = [toolchain.gppExecutable];
    environment = { ...process.env, ...toolchain.childEnvironment };
    staticFlags = ["-static"];
  }
  const result = Bun.spawnSync(
    [
      ...compiler,
      "-std=c++17",
      "-pthread",
      ...staticFlags,
      patchedMain,
      join(import.meta.dir, "stalled-llama-server.cpp"),
      "-o",
      harness,
    ],
    { stdout: "pipe", stderr: "pipe", ...(environment === undefined ? {} : { env: environment }) },
  );
  if (result.exitCode !== 0) {
    throw new Error(`failed to compile stalled-main harness: ${result.stderr.toString()}`);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  context: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${context} timed out after ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function owner(mode: TestMode): Promise<never> {
  const port = mode === "stalled-main" ? 0 : await reserveEphemeralPort();
  const child = Bun.spawn(
    mode === "stalled-main"
      ? [harness]
      : [executable, ...llamaArguments(model, port, "liveness-test")],
    {
      stdin: "pipe",
      stdout: mode === "stalled-main" ? "pipe" : "ignore",
      stderr: "ignore",
      // The three daemon-equivalent modes exercise the opt-in parent-liveness
      // watcher, so they must carry the same opt-in the daemon spawns with.
      env: { ...childEnvironment, LLAMA_PARENT_LIVENESS_STDIN: "1" },
    },
  );
  console.log(`child:${child.pid}`);

  try {
    if (mode === "startup") {
      await new Promise(() => undefined);
    }

    if (mode === "stalled-main") {
      const output = child.stdout;
      if (!(output instanceof ReadableStream)) {
        throw new Error("stalled-main harness stdout pipe is unavailable");
      }
      const reader = output.getReader();
      const first = await withTimeout(reader.read(), 5_000, "stalled-main harness entry");
      if (first.done || !new TextDecoder().decode(first.value).includes("entered")) {
        throw new Error("stalled-main harness did not enter llama_server");
      }
      console.log("stalled");
      await new Promise(() => undefined);
    }

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          break;
        }
      } catch {
        // Startup is still in progress.
      }
      await Bun.sleep(20);
    }
    if (Date.now() >= deadline) {
      throw new Error("native server did not become ready within 15 seconds");
    }

    let response: Response | undefined;
    let requestError: unknown;
    const request = fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "hello ".repeat(1_000),
      }),
    }).then(
      (value) => {
        response = value;
        return value;
      },
      (error: unknown) => {
        requestError = error;
        throw error;
      },
    );
    await Bun.sleep(1);
    if (response !== undefined || requestError !== undefined) {
      if (response !== undefined && !response.ok) {
        throw new Error(`embedding was rejected before parent kill: HTTP ${response.status}`);
      }
      throw new Error("embedding completed before the parent-kill checkpoint");
    }
    console.log("encoding");
    const completed = await request;
    if (!completed.ok) {
      throw new Error(`embedding request failed: HTTP ${completed.status}`);
    }
    throw new Error("embedding completed before the owner was killed");
  } finally {
    child.kill("SIGKILL");
  }
}

async function waitForOwnerState(
  stream: ReadableStream<Uint8Array>,
  mode: TestMode,
): Promise<number> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let childPid: number | undefined;
  const readState = async (): Promise<number> => {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (result.value) {
        buffered += decoder.decode(result.value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("child:")) {
            childPid = Number(line.slice("child:".length));
            if (mode === "startup") {
              return childPid;
            }
          }
          if ((line === "encoding" || line === "stalled") && childPid !== undefined) {
            return childPid;
          }
        }
      }
    }
    throw new Error(`owner exited before requested state; output=${JSON.stringify(buffered)}`);
  };
  return await withTimeout(readState(), 20_000, `owner state (${buffered})`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function test(mode: TestMode): Promise<void> {
  if (mode !== "direct-version") {
    if (
      statSync(model).size !== buildConfig.model.bytes ||
      sha256File(model) !== buildConfig.model.sha256
    ) {
      throw new Error("validation model does not match the pinned Q4_0 manifest");
    }
  }

  if (mode === "direct-version") {
    // Regression for the silent-exit defect: without the daemon opt-in, an EOF
    // stdin must not kill the runtime. Before the opt-in gate, this invocation
    // exited 0 with zero output because the watcher won the startup race.
    const child = Bun.spawn([executable, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: childEnvironment,
    });
    const stderrText = await withTimeout(
      new Response(child.stderr as ReadableStream).text(),
      10_000,
      "direct --version",
    );
    const code = await withTimeout(child.exited, 10_000, "direct --version exit");
    if (code !== 0) {
      throw new Error(`direct --version exited with ${code}`);
    }
    if (!stderrText.includes("version:")) {
      throw new Error(
        `direct invocation exited silently without a version banner: ${JSON.stringify(stderrText)}`,
      );
    }
    console.log("PASS: direct invocation without the opt-in printed the version banner");
    return;
  }

  if (mode === "stalled-main") {
    await ensureHarness();
  }

  const ownerProcess = Bun.spawn([process.execPath, import.meta.path, "--owner", "--mode", mode], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
    env: process.env,
  });
  const stdout = ownerProcess.stdout;
  if (!(stdout instanceof ReadableStream)) {
    throw new Error("owner stdout pipe is unavailable");
  }

  let childPid: number | undefined;
  try {
    childPid = await waitForOwnerState(stdout, mode);
    if (!Number.isSafeInteger(childPid) || childPid <= 0) {
      throw new Error(`invalid native pid from owner: ${childPid}`);
    }

    if (mode === "encoding") {
      await Bun.sleep(10);
    }

    ownerProcess.kill("SIGKILL");
    await ownerProcess.exited;

    const deadline = Date.now() + 5_000;
    while (processExists(childPid) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    if (processExists(childPid)) {
      throw new Error(`native process ${childPid} survived parent SIGKILL in ${mode} mode`);
    }

    console.log(`PASS: native process ${childPid} exited after parent SIGKILL during ${mode}`);
  } finally {
    ownerProcess.kill("SIGKILL");
    if (childPid !== undefined && processExists(childPid)) {
      process.kill(childPid, "SIGKILL");
    }
  }
}

const mode = argument("--mode") ?? "startup";
if (
  mode !== "startup" &&
  mode !== "encoding" &&
  mode !== "stalled-main" &&
  mode !== "direct-version"
) {
  throw new Error(`unsupported --mode ${mode}`);
}

if (process.argv.includes("--owner")) {
  await owner(mode);
} else {
  await test(mode);
}
