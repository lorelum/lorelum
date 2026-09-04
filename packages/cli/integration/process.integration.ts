import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";

const entrypoint = join(import.meta.dir, "../src/main.ts");
const bunExecutable = Bun.which("bun");
const processTimeoutMs = 60_000;

async function writeLocalStoreFixturePack(directory: string): Promise<string> {
  const packRoot = join(directory, "localstore-fixture-pack");
  const practices = join(packRoot, "practices", "react");
  await mkdir(practices, { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), "name: integration-query-get\nversion: 0.1.0\n");
  await writeFile(
    join(practices, "api-client.md"),
    [
      "---",
      "id: react.api-client",
      "title: Layer React API access",
      "stage: api-layer",
      "tech_stack: [react, typescript]",
      "applies_when: adding remote requests to a React interface",
      "severity: warn",
      "---",
      "Keep transport, DTO translation, and expected failures behind a feature API boundary.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(practices, "resource-state.md"),
    [
      "---",
      "id: react.resource-state",
      "title: Separate resource and UI state",
      "stage: state",
      "tech_stack: [react, typescript]",
      "applies_when: storing remote resource data used by a React interface",
      "severity: warn",
      "---",
      "Model resource data separately from view state and transform DTOs at the boundary.",
      "",
    ].join("\n"),
  );
  return packRoot;
}

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

  const packRoot = await writeLocalStoreFixturePack(directory);
  const decoded = await decodePackDirectory(packRoot);
  const storeRoot = { rootPath: join(directory, "store") };
  await createLocalStore().install(storeRoot, decoded.candidate, decoded.diagnostics);

  const query = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "query",
    "remote requests React interface",
  ]);
  assert.equal(query.exitCode, 0);
  const queryResponse: unknown = JSON.parse(query.stdout);
  assert(isRecord(queryResponse));
  assert.equal(queryResponse.command, "query");
  assert.equal(queryResponse.ok, true);
  assert(isRecord(queryResponse.data));
  assert.equal(queryResponse.data.total, 2);
  assert(Array.isArray(queryResponse.data.results));
  assert.equal(queryResponse.data.results[0]?.id, "react.api-client");
  assert.equal(query.stderr, "");

  const get = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "get",
    "react.api-client",
  ]);
  assert.equal(get.exitCode, 0);
  const getResponse: unknown = JSON.parse(get.stdout);
  assert(isRecord(getResponse));
  assert.equal(getResponse.command, "get");
  assert.equal(getResponse.ok, true);
  assert(isRecord(getResponse.data));
  assert(isRecord(getResponse.data.practice));
  assert.equal(getResponse.data.practice.id, "react.api-client");
  assert.equal(getResponse.data.practice.title, "Layer React API access");
  assert.equal(
    getResponse.data.practice.body,
    "Keep transport, DTO translation, and expected failures behind a feature API boundary.\n",
  );
  assert.equal(get.stderr, "");

  const emptyQuery = await runProcess([
    executable,
    "--store-root",
    join(directory, "empty-store"),
    "query",
    "remote requests",
  ]);
  assert.equal(emptyQuery.exitCode, 0);
  const emptyQueryResponse: unknown = JSON.parse(emptyQuery.stdout);
  assert(isRecord(emptyQueryResponse));
  assert.equal(emptyQueryResponse.command, "query");
  assert.equal(emptyQueryResponse.ok, true);
  assert(isRecord(emptyQueryResponse.data));
  assert.equal(emptyQueryResponse.data.total, 0);
  assert.deepEqual(emptyQueryResponse.data.results, []);
  assert.equal(emptyQuery.stderr, "");

  const unknown = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "get",
    "react.missing",
  ]);
  assert.equal(unknown.exitCode, 2);
  assert.deepEqual(selectProtocolFields(unknown.stdout), {
    command: "get",
    errorCode: "get.unknown_practice",
    ok: false,
  });
  assert.equal(unknown.stderr, "");

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
