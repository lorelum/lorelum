import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entrypoint = join(import.meta.dir, "../src/main.ts");
const bunExecutable = Bun.which("bun");
const processTimeoutMs = 60_000;

if (bunExecutable === null) {
  throw new Error("Bun executable is required for CLI integration tests.");
}

await assert.rejects(
  runProcess([bunExecutable, "-e", "setInterval(() => undefined, 1_000);"], 100),
  /Process timed out after 100 ms:/,
);

const source = await runProcess([bunExecutable, entrypoint, "--version"]);
assert.equal(source.exitCode, 0);
assert.deepEqual(selectProtocolFields(source.stdout), { command: "version", ok: true });
assert.equal(source.stderr, "");

const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
const executable = join(directory, process.platform === "win32" ? "lore.exe" : "lore");

try {
  const build = await runProcess([
    bunExecutable,
    "build",
    "--compile",
    entrypoint,
    "--outfile",
    executable,
  ]);
  assert.equal(build.exitCode, 0);

  const binary = await runProcess([executable, "--version"]);
  assert.equal(binary.exitCode, 0);
  assert.deepEqual(selectProtocolFields(binary.stdout), { command: "version", ok: true });
  assert.equal(binary.stderr, "");

  const discovery = await runProcess([executable]);
  assert.equal(discovery.exitCode, 0);
  assert.deepEqual(selectProtocolFields(discovery.stdout), { command: "describe", ok: true });
  assert.equal(discovery.stderr, "");

  const invalid = await runProcess([executable, "--private-token"]);
  assert.equal(invalid.exitCode, 2);
  assert.deepEqual(selectProtocolFields(invalid.stdout), {
    command: "unknown",
    errorCode: "usage.invalid",
    ok: false,
  });
  assert.equal(invalid.stdout.includes("private-token"), false);
  assert.equal(invalid.stderr, "");
} finally {
  await rm(directory, { force: true, recursive: true });
}

function selectProtocolFields(stdout: string): {
  command: unknown;
  errorCode?: unknown;
  ok: unknown;
} {
  const response: unknown = JSON.parse(stdout);
  assert(isRecord(response));

  const error = response.error;
  return {
    command: response.command,
    ...(isRecord(error) ? { errorCode: error.code } : {}),
    ok: response.ok,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runProcess(
  command: string[],
  timeoutMs = processTimeoutMs,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn({ cmd: command, stderr: "pipe", stdout: "pipe" });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const executableName = command[0] ?? "<missing executable>";
      try {
        child.kill();
      } catch (error) {
        reject(
          new Error(
            `Process timed out after ${timeoutMs} ms and could not be terminated: ${executableName}`,
            { cause: error },
          ),
        );
        return;
      }
      reject(new Error(`Process timed out after ${timeoutMs} ms: ${executableName}`));
    }, timeoutMs);
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]),
      timeout,
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
