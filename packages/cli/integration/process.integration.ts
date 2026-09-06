import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

  const isolatedDiscovery = await runProcess([
    executable,
    "--store-root",
    join(directory, "worktree-store"),
  ]);
  assert.equal(isolatedDiscovery.exitCode, 0);
  assert.deepEqual(selectProtocolFields(isolatedDiscovery.stdout), {
    command: "describe",
    ok: true,
  });
  assert.equal(isolatedDiscovery.stderr, "");

  const invalid = await runProcess([executable, "--private-token"]);
  assert.equal(invalid.exitCode, 2);
  assert.deepEqual(selectProtocolFields(invalid.stdout), {
    command: "unknown",
    errorCode: "usage.invalid",
    ok: false,
  });
  assert.equal(invalid.stdout.includes("private-token"), false);
  assert.equal(invalid.stderr, "");

  await exerciseGet(executable, directory);
} finally {
  await rm(directory, { force: true, recursive: true });
}

/**
 * Install one synthetic Pack through the public engine API in a separate
 * process, then verify the compiled CLI reads the persisted snapshot.
 */
async function exerciseGet(compiledBinary: string, workingDirectory: string): Promise<void> {
  const packDirectory = join(workingDirectory, "fixture-pack");
  const storageRoot = join(workingDirectory, "fixture-store");
  const practiceId = "integration.retrieval.demo";
  await mkdir(join(packDirectory, "practices"), { recursive: true });
  await writeFile(
    join(packDirectory, "pack.yaml"),
    "name: integration-pack\nversion: 1.0.0\ndescription: Process integration fixture.\n",
  );
  await writeFile(
    join(packDirectory, "practices", "retrieval-demo.md"),
    `---
id: ${practiceId}
title: Persisted retrieval demo
stage: integration
tech_stack: [bun, typescript]
applies_when: exercising the compiled get command
anti_patterns:
  - id: integration.retrieval.skip
    name: Skip persisted state
    description: Do not bypass the local snapshot.
---
# Persisted guidance

This complete body must survive installation and retrieval.
`,
  );

  const engineEntrypoint = join(import.meta.dir, "../../engine/src/index.ts");
  const installer = `
const { decodePackDirectory, createLocalStore } = await import(${JSON.stringify(engineEntrypoint)});
const decoded = await decodePackDirectory(${JSON.stringify(packDirectory)});
const result = await createLocalStore().install(
  { rootPath: ${JSON.stringify(storageRoot)} },
  decoded.candidate,
  decoded.diagnostics,
);
console.log(JSON.stringify({ generation: result.generation, effectiveRevision: result.effectiveRevision }));
`;
  const installed = await runProcess([bunExecutable!, "-e", installer]);
  assert.equal(installed.exitCode, 0, installed.stderr || installed.stdout);
  assert.equal(installed.stderr, "");
  assert.equal(installed.stdout.trim().split(/\r?\n/).length, 1);

  const first = await runGet(compiledBinary, practiceId, storageRoot);
  assert.equal(first.exitCode, 0);
  assert.equal(first.stderr, "");
  const firstResponse = parseSingleResponse(first.stdout);
  assert.equal(firstResponse.command, "get");
  assert.equal(firstResponse.ok, true);
  assert(isRecord(firstResponse.data));
  assert(isRecord(firstResponse.data.practice));
  assert.deepEqual(firstResponse.data.practice, {
    id: practiceId,
    title: "Persisted retrieval demo",
    stage: "integration",
    tech_stack: ["bun", "typescript"],
    applies_when: "exercising the compiled get command",
    severity: "warn",
    body: "# Persisted guidance\n\nThis complete body must survive installation and retrieval.\n",
    anti_patterns: [
      {
        id: "integration.retrieval.skip",
        name: "Skip persisted state",
        description: "Do not bypass the local snapshot.",
        severity: "warn",
      },
    ],
  });
  assert.equal(typeof firstResponse.data.practice.body, "string");
  assert.match(String(firstResponse.data.contentDigest), /^[0-9a-f]{64}$/);
  assert.deepEqual(firstResponse.data.sources, [
    { packName: "integration-pack", sourcePath: "practices/retrieval-demo.md" },
  ]);

  const firstStdout = first.stdout;
  const second = await runGet(compiledBinary, practiceId, storageRoot, "before");
  assert.equal(second.exitCode, 0);
  assert.equal(second.stdout, firstStdout);
  const third = await runGet(compiledBinary, practiceId, storageRoot, "after");
  assert.equal(third.exitCode, 0);
  assert.equal(third.stdout, firstStdout);

  const absent = await runGet(compiledBinary, "integration.retrieval.absent", storageRoot);
  assert.equal(absent.exitCode, 2);
  assert.equal(absent.stderr, "");
  const absentResponse = parseSingleResponse(absent.stdout);
  assert.equal(absentResponse.ok, false);
  assert.equal(isRecord(absentResponse.error) && absentResponse.error.code, "practice.not-found");

  const isolatedRoot = join(workingDirectory, "isolated-store");
  await mkdir(isolatedRoot, { recursive: true });
  const isolated = await runGet(compiledBinary, practiceId, isolatedRoot);
  assert.equal(isolated.exitCode, 2);
  const isolatedResponse = parseSingleResponse(isolated.stdout);
  assert.equal(
    isRecord(isolatedResponse.error) && isolatedResponse.error.code,
    "practice.not-found",
  );

  const malformedRoot = join(workingDirectory, "malformed-store");
  const malformed = await runGet(compiledBinary, "invalid-id", malformedRoot);
  assert.equal(malformed.exitCode, 2);
  assert.equal(malformed.stderr, "");
  const malformedResponse = parseSingleResponse(malformed.stdout);
  assert.equal(malformedResponse.ok, false);
  assert.equal(isRecord(malformedResponse.error) && malformedResponse.error.code, "usage.invalid");
  assert.equal(existsSync(malformedRoot), false, "malformed IDs must not create a Store root");
}

async function runGet(
  binaryPath: string,
  practiceId: string,
  storageRoot: string,
  globalPosition: "before" | "after" = "after",
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const args =
    globalPosition === "before"
      ? [binaryPath, "--store-root", storageRoot, "get", practiceId]
      : [binaryPath, "get", practiceId, "--store-root", storageRoot];
  return runProcess(args);
}

function parseSingleResponse(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `expected one JSON response line, got ${lines.length}`);
  const response: unknown = JSON.parse(lines[0]!);
  assert(isRecord(response));
  return response;
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
