/* eslint-disable no-await-in-loop -- Each command observes the preceding attempt on one shared model lifecycle. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLoggingSettings } from "@lorelum/config";
import { DEFAULT_BACKEND_SETTINGS } from "../../backend/src/config/model";
import { createBackendClient } from "../../backend/src/client/client";
import { readTraceDiagnosticFacts } from "../../backend/src/diagnostics/trace-projection";
import { createBackendSupervisor } from "../../backend/src/runtime/supervisor";
import { readRecord } from "../../backend/src/runtime/runtime-state";
import { waitUntil } from "../../backend/integration/support/process";
import { run } from "../src/main";
import { createModelCommands } from "../src/model/commands";
import { createLogCommands } from "../src/log/command";
import { createFeedbackCommand } from "../src/feedback/command";
import { publishFeedbackArtifact } from "../src/feedback/artifacts";
import { readTraceLogs } from "../src/feedback/logs";
import { createTraceId, type LogRecord, type TraceId } from "@lorelum/log";
import { createInstalledPacksFixture } from "./fixtures/installed-packs";

// Run after build:native. Uses the real daemon, authenticated HTTP, resource checks,
// persisted logs and CLI handlers; only paths/port are isolated from the user's Backend.
const directory = await realpath(await mkdtemp(join(tmpdir(), "lore-preparation-debug-")));
const logDirectory = join(directory, "logs");
const runtimeDirectory = join(directory, "runtime");
const modelPath = join(directory, "invalid-model.gguf");
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const baseUrl = `http://127.0.0.1:${reservation.port}`;
await reservation.stop(true);
const buildIdentity = "integration-build";
const supervisor = createBackendSupervisor({
  config: { runtimeDirectory, settings: DEFAULT_BACKEND_SETTINGS, embedding: { modelPath } },
  logDirectory,
  command: [process.execPath, join(import.meta.dir, "../../backend/integration/daemon.ts")],
  buildIdentity,
  baseUrl,
});
async function backendClient(traceId?: TraceId, debug = false) {
  await supervisor.start();
  const identity = await readRecord(runtimeDirectory);
  assert(identity);
  return createBackendClient({
    identity,
    secret: identity.secret,
    baseUrl,
    ...(traceId === undefined ? {} : { traceId }),
    ...(debug ? { diagnosticLevel: "debug" as const } : {}),
  });
}
const registry = [
  ...createModelCommands({
    createClient: backendClient,
    progressWriter: { write() {} },
  }),
  ...createLogCommands(),
  createFeedbackCommand({
    readTraceDiagnostics: (traceId) => readTraceDiagnosticFacts(traceId, { logDirectory }),
    readTraceLogs: (traceId, level) => readTraceLogs(traceId, level, { logDirectory }),
    defaultOutputDirectory: () => join(directory, "feedback"),
    readInput: (source) => Bun.file(source).text(),
    publish: publishFeedbackArtifact,
  }),
];

async function invoke(args: string[]) {
  let stdout = "";
  let stderr = "";
  const exitCode = await run(["--json", ...args], {
    registry,
    logDirectory,
    stdout: {
      write: (value) => {
        stdout += value;
      },
    },
    stderr: {
      write: (value) => {
        stderr += value;
      },
    },
  });
  assert.equal(stderr, "");
  return { exitCode, response: JSON.parse(stdout) };
}

async function verifyEvidence(traceId: TraceId) {
  await waitUntil("resource debug failure log", async () =>
    (await readTraceLogs(traceId, "debug", { logDirectory })).records.some(
      (record) => record.message === "backend.resource.failed",
    ),
  );
  const selected = await readTraceLogs(traceId, "debug", { logDirectory });
  const request = selected.records.find((record) => record.message === "backend.request.started");
  if (request !== undefined) {
    assert(
      selected.records.some(
        (record) =>
          record.message === "trace.preparation.accepted" && record.requestId === request.requestId,
      ),
    );
  }
  const logs = await invoke(["logs", "--trace-id", traceId, "--level", "debug"]);
  assert.equal(logs.exitCode, 0);
  const records: LogRecord[] = logs.response.data.records;
  assert(
    records.some(
      (record) =>
        record.message === "backend.resource.verified" &&
        (record.context?.resource as { kind?: string })?.kind === "native",
    ),
  );
  const resourceFailure = records.find((record) => record.message === "backend.resource.failed");
  assert(resourceFailure);
  assert.equal(resourceFailure.context?.path, modelPath);
  assert.equal(
    (resourceFailure.context?.resource as { check: string } | undefined)?.check,
    "size-mismatch",
  );
  const draft = await invoke([
    "feedback",
    "draft",
    "--trace-id",
    traceId,
    "--kind",
    "bug",
    "--include-logs",
    "debug",
  ]);
  assert.equal(draft.exitCode, 0);
  assert.deepEqual(draft.response.data.missingEvidence, []);
  const markdown = await readFile(draft.response.data.markdownPath, "utf8");
  assert(markdown.includes("backend.resource.failed"));
  assert(markdown.includes("size-mismatch"));
  assert(markdown.includes(modelPath));
}

try {
  await writeFile(modelPath, "invalid model fixture");
  const loggingBefore = await loadLoggingSettings();
  const plain = await invoke(["model", "load"]);
  assert.equal(plain.exitCode, 2);
  assert.equal(plain.response.error.code, "embedding.resource-invalid");
  const plainTrace: TraceId = plain.response.diagnostics.traceId;
  await waitUntil("normal preparation failure log", async () =>
    (await readTraceLogs(plainTrace, "info", { logDirectory })).records.some(
      (record) => record.message === "backend.preparation.failed",
    ),
  );
  if (loggingBefore.level !== "debug") {
    const plainLogs = await readTraceLogs(plainTrace, "debug", { logDirectory });
    assert(
      !plainLogs.records.some((record) => record.source === "backend" && record.level === "debug"),
    );
    assert(plainLogs.missingEvidence.includes("debug-records-not-found"));
  }

  for (const args of [
    ["--debug", "model", "load"],
    ["model", "load", "--debug"],
  ]) {
    const failure = await invoke(args);
    assert.equal(failure.exitCode, 2);
    assert.equal(failure.response.error.code, "embedding.resource-invalid");
    await verifyEvidence(failure.response.diagnostics.traceId);
  }
  const fixture = await createInstalledPacksFixture(directory);
  const root = { rootPath: fixture.storageRoot };
  for (const entry of ["query", "buildIndex", "rebuildIndex"] as const) {
    const traceId = createTraceId();
    const client = await backendClient(traceId, true);
    await client.unloadModel();
    const cacheRoot = join(directory, `cache-${entry}`);
    if (entry === "query") {
      await assert.rejects(
        client.query(root, {
          text: "debug preparation",
          mode: "semantic",
          cacheRoot,
          maxWaitMs: 1_000,
        }),
        { code: "embedding.resource-invalid" },
      );
    } else {
      const operation = await client[entry](root, { cacheRoot });
      await waitUntil(
        "automatic preparation operation failure",
        async () => (await client.indexOperation(operation.operationId)).state === "failed",
      );
    }
    await verifyEvidence(traceId);
  }
  assert.deepEqual(await loadLoggingSettings(), loggingBefore);
  console.log(
    JSON.stringify({
      scenario: "backend-preparation-debug",
      status: "passed",
      debugBeforeAndAfterSubcommand: true,
      automaticQueryAndIndexPreparation: true,
      resourceChecksVisibleInLogsAndDraft: true,
      persistentLoggingUnchanged: true,
    }),
  );
} finally {
  await supervisor.stop();
  await rm(directory, { recursive: true, force: true });
}
