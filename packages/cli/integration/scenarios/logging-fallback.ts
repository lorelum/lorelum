import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runProcess } from "../support/process.js";
import { isRecord, parseSingleResponse, requireSuccessData } from "../support/protocol.js";

/** Merged env that redirects the Lorelum home (config, logs, store defaults). */
function isolatedHomeEnvironment(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home };
}

function requireDiagnostics(response: Record<string, unknown>): {
  traceId: string;
  notices?: unknown;
} {
  const diagnostics = response.diagnostics;
  assert(isRecord(diagnostics));
  assert.equal(typeof diagnostics.traceId, "string");
  return diagnostics as { traceId: string; notices?: unknown };
}

/**
 * Verify the full process chain of an invalid persistent logging.level
 * (issue #230): the invocation notice, the stderr line, the trace evidence,
 * `lore logs`, the feedback draft explanation, the --debug override facts, and
 * the healthy-config control.
 */
export async function verifyLoggingFallbackScenario(
  compiledBinary: string,
  workingDirectory: string,
  sourceCommand: readonly string[],
): Promise<void> {
  const home = await mkdtemp(join(workingDirectory, "fallback-home-"));
  await mkdir(join(home, ".lorelum"), { recursive: true });
  await writeFile(join(home, ".lorelum", "config.yaml"), "logging:\n  level: noisy\n");
  const environment = isolatedHomeEnvironment(home);
  const storeRoot = join(workingDirectory, "fallback-store");
  const warningLine =
    'warning: logging.level "noisy" is invalid (allowed: error, warn, info, debug); using "info" for this invocation.\n';
  const expectedNotice = {
    kind: "configuration",
    subject: "logging.level",
    reason: "invalid-value",
    received: "noisy",
    expected: { kind: "enum", values: ["error", "warn", "info", "debug"] },
    effective: "info",
    source: join(home, ".lorelum", "config.yaml"),
  };

  // A normal text command completes while stating the fallback on stderr.
  const text = await runProcess(
    [compiledBinary, "--store-root", storeRoot, "pack", "list"],
    60_000,
    undefined,
    environment,
  );
  assert.equal(text.exitCode, 0, text.stderr);
  assert.equal(text.stderr, warningLine);

  // The same command in JSON mode keeps one stdout line and carries the notice.
  const json = await runProcess(
    [compiledBinary, "--store-root", storeRoot, "pack", "list", "--json"],
    60_000,
    undefined,
    environment,
  );
  assert.equal(json.exitCode, 0, json.stderr);
  assert.equal(json.stderr, warningLine);
  const response = parseSingleResponse(json.stdout);
  assert.deepEqual(requireSuccessData(response, "pack.list").packs, []);
  const diagnostics = requireDiagnostics(response);
  assert.deepEqual(diagnostics.notices, [expectedNotice]);
  const traceId = diagnostics.traceId;

  // The source entrypoint behaves the same way, not only the compiled binary.
  const source = await runProcess(
    [...sourceCommand, "--store-root", storeRoot, "pack", "list", "--json"],
    60_000,
    undefined,
    environment,
  );
  assert.equal(source.exitCode, 0, source.stderr);
  const sourceDiagnostics = requireDiagnostics(parseSingleResponse(source.stdout));
  assert.deepEqual(sourceDiagnostics.notices, [expectedNotice]);

  // `lore logs --trace-id` exposes the fallback as warn evidence for the trace.
  const logs = await runProcess(
    [compiledBinary, "logs", "--trace-id", traceId, "--json"],
    60_000,
    undefined,
    environment,
  );
  assert.equal(logs.exitCode, 0, logs.stderr);
  const logsData = requireSuccessData(parseSingleResponse(logs.stdout), "logs");
  const fallbackRecords = (logsData.records as unknown[]).filter(
    (record) =>
      isRecord(record) &&
      record.message === "logging.level-fallback" &&
      record.level === "warn" &&
      record.traceId === traceId,
  );
  assert.equal(fallbackRecords.length, 1);

  // The debug feedback draft explains why no debug records exist for this trace.
  const draft = await runProcess(
    [
      compiledBinary,
      "feedback",
      "draft",
      "--trace-id",
      traceId,
      "--kind",
      "bug",
      "--include-logs",
      "debug",
      "--output",
      join(workingDirectory, "fallback-feedback"),
      "--json",
    ],
    60_000,
    undefined,
    environment,
  );
  assert.equal(draft.exitCode, 0, draft.stderr);
  const draftData = requireSuccessData(parseSingleResponse(draft.stdout), "feedback.draft");
  assert.equal(draftData.state, "draft");
  assert.equal(
    (draftData.missingEvidence as unknown[]).includes("debug-records-not-found"),
    true,
    `missing evidence: ${JSON.stringify(draftData.missingEvidence)}`,
  );
  const report = JSON.parse(await readFile(String(draftData.reportPath), "utf8")) as unknown;
  assert(isRecord(report));
  const detailed = (report.evidence as unknown[]).filter(
    (entry) => isRecord(entry) && entry.type === "detailed-logs",
  );
  assert.equal(detailed.length, 1);
  const detailedRecords = (detailed[0] as { records?: unknown }).records as unknown[];
  assert.equal(
    detailedRecords.some(
      (record) =>
        isRecord(record) &&
        record.message === "logging.level-fallback" &&
        record.level === "warn" &&
        isRecord(record.context) &&
        record.context.effective === "info",
    ),
    true,
    "the draft must carry the fallback record that explains the missing debug evidence",
  );

  // A --debug override reports both facts: persistent rejection and effective debug.
  const debugRun = await runProcess(
    [compiledBinary, "--debug", "--store-root", storeRoot, "pack", "list", "--json"],
    60_000,
    undefined,
    environment,
  );
  assert.equal(debugRun.exitCode, 0, debugRun.stderr);
  assert.match(debugRun.stderr, /--debug overrides persistent config/);
  const debugNotices = requireDiagnostics(parseSingleResponse(debugRun.stdout))
    .notices as unknown[];
  assert.equal(debugNotices.length, 1);
  const debugNotice = debugNotices[0] as { effective?: unknown; received?: unknown };
  assert.equal(debugNotice.effective, "debug");
  assert.equal(debugNotice.received, "noisy");

  // A healthy configuration adds no notice and no stderr noise.
  const healthyHome = await mkdtemp(join(workingDirectory, "healthy-home-"));
  const healthy = await runProcess(
    [compiledBinary, "--store-root", storeRoot, "pack", "list", "--json"],
    60_000,
    undefined,
    isolatedHomeEnvironment(healthyHome),
  );
  assert.equal(healthy.exitCode, 0, healthy.stderr);
  assert.equal(healthy.stderr, "");
  const healthyDiagnostics = requireDiagnostics(parseSingleResponse(healthy.stdout));
  assert.equal("notices" in healthyDiagnostics, false);
  assert.deepEqual(Object.keys(healthyDiagnostics), ["traceId"]);
}
