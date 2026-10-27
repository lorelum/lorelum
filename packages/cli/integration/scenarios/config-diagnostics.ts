import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createInstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runProcess } from "../support/process.js";
import {
  isRecord,
  parseSingleResponse,
  requireFailureCode,
  requireSuccessData,
  type JsonRecord,
} from "../support/protocol.js";

const timeoutMs = 60_000;
const credentialMarker = "config-diagnostics-synthetic-password";
const credentialValue = `https://user:${credentialMarker}@example.invalid/private-token`;

interface IsolatedHome {
  readonly directory: string;
  readonly configFile: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** Exercise config failures and logging fallback through a real isolated user installation. */
export async function verifyConfigDiagnosticsScenario(
  command: readonly string[],
  directory: string,
): Promise<void> {
  const scratch = await realpath(await mkdtemp(join(directory, "config-diagnostics-")));
  try {
    const fixtureDirectory = join(scratch, "packs");
    const fixture = await createInstalledPacksFixture(fixtureDirectory);

    await verifyStrictQueryFailure(command, scratch, fixture.storageRoot);
    await verifyStrictBackendFailure(command, scratch);
    await verifyDocumentFailureDeduplication(command, scratch, fixture.storageRoot);
    await verifyIndependentLoggingFailure(command, scratch, fixture.storageRoot);

    const fallbackHome = await createIsolatedHome(scratch, "logging-fallback");
    await writeConfig(fallbackHome, `logging:\n  level: ${JSON.stringify(credentialValue)}\n`);
    const fallback = await run(command, scratch, fallbackHome, [
      "--json",
      "--log-level",
      "error",
      "pack",
      "list",
      "--store-root",
      fixture.storageRoot,
    ]);
    assert.equal(fallback.exitCode, 0);
    const fallbackEnvelope = parseSingleResponse(fallback.stdout);
    assertV2SuccessEnvelope(fallbackEnvelope, "pack.list");
    const fallbackData = requireSuccessData(fallbackEnvelope, "pack.list");
    assert(Array.isArray(fallbackData.packs));
    assert.equal(fallbackData.packs.length, 2);
    assertFallbackNotice(fallback.stderr, fallbackHome.configFile, "info");
    assertNoCredential(credentialMarker, fallback.stdout, fallback.stderr);
    const fallbackTrace = traceIdOf(fallbackEnvelope);

    const textFallback = await run(command, scratch, fallbackHome, [
      "pack",
      "list",
      "--store-root",
      fixture.storageRoot,
    ]);
    assert.equal(textFallback.exitCode, 0);
    assert(textFallback.stdout.includes("integration-pack"));
    assertFallbackNotice(textFallback.stderr, fallbackHome.configFile, "info");
    assertNoCredential(credentialMarker, textFallback.stdout, textFallback.stderr);

    const traceRead = await readTrace(command, scratch, fallbackHome, fallbackTrace);
    const fallbackRecord = requireFallbackRecord(traceRead.records, fallbackTrace, "info");
    assertNoCredential(credentialMarker, JSON.stringify(fallbackRecord));

    const feedback = await run(command, scratch, fallbackHome, [
      "--json",
      "feedback",
      "draft",
      "--trace-id",
      fallbackTrace,
      "--kind",
      "bug",
      "--include-logs",
      "debug",
      "--output",
      join(scratch, "feedback-drafts"),
    ]);
    assert.equal(feedback.exitCode, 0);
    const feedbackEnvelope = parseSingleResponse(feedback.stdout);
    assertV2SuccessEnvelope(feedbackEnvelope, "feedback.draft");
    assertFallbackNotice(feedback.stderr, fallbackHome.configFile, "info");
    const feedbackData = requireSuccessData(feedbackEnvelope, "feedback.draft");
    assert.equal(feedbackData.state, "draft");
    assert.equal(typeof feedbackData.reportPath, "string");
    assert(
      Array.isArray(feedbackData.missingEvidence) &&
        feedbackData.missingEvidence.includes("debug-records-not-found"),
      "a warning record must not imply that debug records were collected",
    );
    const reportText = await readFile(String(feedbackData.reportPath), "utf8");
    const report: unknown = JSON.parse(reportText);
    assert(isRecord(report));
    assert.equal(isRecord(report.trace) && report.trace.id, fallbackTrace);
    assert(Array.isArray(report.evidence));
    assert(
      Array.isArray(report.missingEvidence) &&
        report.missingEvidence.includes("debug-records-not-found"),
      "feedback must preserve the existing debug-records-not-found evidence marker",
    );
    const detailed = report.evidence.find(
      (evidence) => isRecord(evidence) && evidence.type === "detailed-logs",
    );
    assert(isRecord(detailed));
    assert(Array.isArray(detailed.records));
    assert(
      detailed.records.some(
        (record) =>
          isRecord(record) &&
          record.message === "logging.level-fallback" &&
          record.traceId === fallbackTrace &&
          record.level === "warn",
      ),
      "feedback should read back the actual fallback warning for the selected trace",
    );
    assertNoCredential(credentialMarker, feedback.stdout, feedback.stderr, reportText);

    await verifyDebugFallback(command, scratch, fallbackHome);
    await verifySinkUnavailable(command, scratch, fixture.storageRoot);
    await verifyHookAbi(command, scratch, fixture.storageRoot);
    await verifyKeywordAndCanonicalInstall(command, scratch, fixtureDirectory, fixture.storageRoot);
    await verifyNormalLogging(command, scratch, fixture.storageRoot);
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

async function verifyStrictQueryFailure(
  command: readonly string[],
  directory: string,
  storageRoot: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "query-invalid");
  const contents = "logging:\n  level: info\nquery:\n  maxWaitMs: nope\n";
  await writeConfig(home, contents);

  const json = await run(command, directory, home, [
    "--json",
    "query",
    "integration query",
    "--mode",
    "semantic",
    "--store-root",
    storageRoot,
  ]);
  assert.equal(json.exitCode, 2);
  assert.equal(json.stderr, "");
  const envelope = parseSingleResponse(json.stdout);
  assertV2FailureEnvelope(envelope, "query", "query.config-invalid");
  const error = requiredError(envelope);
  assert.match(error.message, /query\.maxWaitMs/u);
  assert.match(error.message, /0 through 120000/u);
  assert.match(error.message, /Correct or remove/u);
  assert(error.message.includes(home.configFile));
  assert.equal("details" in error, false);
  assert(isRecord(envelope.diagnostics));
  assert.equal("notices" in envelope.diagnostics, false);

  const text = await run(command, directory, home, [
    "query",
    "integration query",
    "--mode",
    "semantic",
    "--store-root",
    storageRoot,
  ]);
  assert.equal(text.exitCode, 2);
  assert.equal(text.stdout, "");
  assert(text.stderr.includes(error.message), "text and JSON must share the same safe message");
  assert.equal(await readFile(home.configFile, "utf8"), contents);
  assertNoCredential(credentialMarker, json.stdout, text.stderr);
}

async function verifyStrictBackendFailure(
  command: readonly string[],
  directory: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "backend-invalid");
  const contents = "logging:\n  level: info\nbackend:\n  requestTimeoutMs: 0\n";
  await writeConfig(home, contents);
  const result = await run(command, directory, home, ["--json", "backend", "start"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  const envelope = parseSingleResponse(result.stdout);
  assertV2FailureEnvelope(envelope, "backend.start", "backend.config-invalid");
  const error = requiredError(envelope);
  assert.match(error.message, /backend\.requestTimeoutMs/u);
  assert(error.message.includes(home.configFile));
  assert.match(error.message, /Correct or remove/u);
  assert.equal("details" in error, false);
  assert(isRecord(envelope.diagnostics));
  assert.equal("notices" in envelope.diagnostics, false);
  const text = await run(command, directory, home, ["backend", "start"]);
  assert.equal(text.exitCode, 2);
  assert.equal(text.stdout, "");
  assert(text.stderr.includes(error.message));
  assert.equal(await readFile(home.configFile, "utf8"), contents);

  const environmentFailure = await run(
    command,
    directory,
    {
      ...home,
      environment: { ...home.environment, LORELUM_BACKEND_REQUEST_TIMEOUT_MS: "001" },
    },
    ["--json", "backend", "start"],
  );
  assert.equal(environmentFailure.exitCode, 2);
  const environmentEnvelope = parseSingleResponse(environmentFailure.stdout);
  assertV2FailureEnvelope(environmentEnvelope, "backend.start", "backend.config-invalid");
  assert.match(requiredError(environmentEnvelope).message, /LORELUM_BACKEND_REQUEST_TIMEOUT_MS/u);
  assert.match(requiredError(environmentEnvelope).message, /without leading zeros/u);

  const embeddingContents = `embedding:\n  download:\n    url: ${JSON.stringify(credentialValue)}\n`;
  await writeConfig(home, embeddingContents);
  const embeddingFailure = await run(command, directory, home, ["--json", "backend", "start"]);
  assert.equal(embeddingFailure.exitCode, 2);
  const embeddingEnvelope = parseSingleResponse(embeddingFailure.stdout);
  assertV2FailureEnvelope(embeddingEnvelope, "backend.start", "backend.config-invalid");
  assert.match(requiredError(embeddingEnvelope).message, /embedding\.download\.url/u);
  assert.match(requiredError(embeddingEnvelope).message, /HTTPS URL without credentials/u);
  assertNoCredential(credentialMarker, embeddingFailure.stdout, embeddingFailure.stderr);
  assert.equal(await readFile(home.configFile, "utf8"), embeddingContents);
}

async function verifyDocumentFailureDeduplication(
  command: readonly string[],
  directory: string,
  storageRoot: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "malformed-document");
  const contents = "query:\n  maxWaitMs: [private-snippet";
  await writeConfig(home, contents);
  const result = await run(command, directory, home, [
    "--json",
    "query",
    "integration query",
    "--mode",
    "semantic",
    "--store-root",
    storageRoot,
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "", "the same YAML failure must not be printed twice");
  const envelope = parseSingleResponse(result.stdout);
  assertV2FailureEnvelope(envelope, "query", "query.config-invalid");
  const error = requiredError(envelope);
  assert.match(error.message, /Invalid YAML/u);
  assert.match(error.message, /line \d+, column \d+/u);
  assert(error.message.includes(home.configFile));
  assertNoCredential(credentialMarker, result.stdout, result.stderr);
  assert.equal(result.stdout.includes("private-snippet"), false);
  assert.equal(await readFile(home.configFile, "utf8"), contents);

  const traceId = traceIdOf(envelope);
  const trace = await readTrace(command, directory, home, traceId, "document");
  requireFallbackRecord(trace.records, traceId, "info");

  const backend = await run(command, directory, home, ["--json", "backend", "start"]);
  assert.equal(backend.exitCode, 2);
  assert.equal(backend.stderr, "", "the Backend adapter must preserve document deduplication");
  assertV2FailureEnvelope(
    parseSingleResponse(backend.stdout),
    "backend.start",
    "backend.config-invalid",
  );
  assert.equal(await readFile(home.configFile, "utf8"), contents);
}

async function verifyIndependentLoggingFailure(
  command: readonly string[],
  directory: string,
  storageRoot: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "independent-logging-failure");
  const contents = `logging:\n  level: ${JSON.stringify(credentialValue)}\nquery:\n  maxWaitMs: nope\n`;
  await writeConfig(home, contents);

  const result = await run(command, directory, home, [
    "--json",
    "query",
    "integration query",
    "--mode",
    "semantic",
    "--store-root",
    storageRoot,
  ]);
  assert.equal(result.exitCode, 2);
  assertFallbackNotice(result.stderr, home.configFile, "info");
  assertNoCredential(credentialMarker, result.stdout, result.stderr);
  const envelope = parseSingleResponse(result.stdout);
  assertV2FailureEnvelope(envelope, "query", "query.config-invalid");
  assert.match(requiredError(envelope).message, /query\.maxWaitMs/u);
  assert.equal(await readFile(home.configFile, "utf8"), contents);
}

async function verifyDebugFallback(
  command: readonly string[],
  directory: string,
  home: IsolatedHome,
): Promise<void> {
  const result = await run(command, directory, home, [
    "--debug",
    "--json",
    "pack",
    "list",
    "--store-root",
    join(directory, "packs", "fixture-store"),
  ]);
  assert.equal(result.exitCode, 0);
  const envelope = parseSingleResponse(result.stdout);
  assertV2SuccessEnvelope(envelope, "pack.list");
  assertFallbackNotice(result.stderr, home.configFile, "debug");
  assertNoCredential(credentialMarker, result.stdout, result.stderr);

  const trace = await readTrace(command, directory, home, traceIdOf(envelope));
  const warning = requireFallbackRecord(trace.records, traceIdOf(envelope), "debug");
  assert(
    trace.records.some(
      (record) =>
        isRecord(record) && record.message === "command.debug-enabled" && record.level === "debug",
    ),
    "--debug must persist the real debug-level command.debug-enabled record",
  );
  assertNoCredential(credentialMarker, JSON.stringify(warning));
}

async function verifySinkUnavailable(
  command: readonly string[],
  directory: string,
  storageRoot: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "logging-sink-unavailable");
  await writeConfig(home, `logging:\n  level: ${JSON.stringify(credentialValue)}\n`);
  await writeFile(join(home.directory, ".lorelum", "logs"), "not a directory", "utf8");

  const result = await run(command, directory, home, [
    "--json",
    "pack",
    "list",
    "--store-root",
    storageRoot,
  ]);
  assert.equal(result.exitCode, 0);
  const envelope = parseSingleResponse(result.stdout);
  assertV2SuccessEnvelope(envelope, "pack.list");
  const data = requireSuccessData(envelope, "pack.list");
  assert(Array.isArray(data.packs));
  assert.equal(data.packs.length, 2);

  const lines = result.stderr.split(/\r?\n/u).filter((line) => line.length > 0);
  assert.equal(lines.length, 2, `expected separate fallback and sink notices: ${result.stderr}`);
  assertFallbackNotice(lines[0]!, home.configFile, "info");
  assert.match(lines[1]!, /diagnostic logs for this run were not saved/u);
  assertNoCredential(credentialMarker, result.stdout, result.stderr);
}

async function verifyHookAbi(
  command: readonly string[],
  directory: string,
  storageRoot: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "hook-invalid-logging");
  await writeConfig(home, `logging:\n  level: ${JSON.stringify(credentialValue)}\n`);
  const hook = await run(
    command,
    directory,
    home,
    ["hook", "codex", "--store-root", storageRoot],
    JSON.stringify({ hook_event_name: "SessionStart" }),
  );
  assert.equal(hook.exitCode, 0);
  const response = parseSingleResponse(hook.stdout);
  assert(isRecord(response.hookSpecificOutput));
  assert.equal("protocolVersion" in response, false);
  assert.equal("command" in response, false);
  assert.equal("diagnostics" in response, false);
  assert.equal("data" in response, false);
  assertFallbackNotice(hook.stderr, home.configFile, "info");
  assertNoCredential(credentialMarker, hook.stdout, hook.stderr);

  const logs = await run(command, directory, home, ["--json", "logs", "--source", "hook.codex"]);
  assert.equal(logs.exitCode, 0);
  assertFallbackNotice(logs.stderr, home.configFile, "info");
  const envelope = parseSingleResponse(logs.stdout);
  const data = requireSuccessData(envelope, "logs");
  assert(Array.isArray(data.records));
  const warning = data.records.find(
    (record) => isRecord(record) && record.message === "logging.level-fallback",
  );
  assert(isRecord(warning));
  assert.equal(warning.source, "hook.codex");
  assert(typeof warning.traceId === "string");
  assert(isRecord(warning.context));
  assert.equal(warning.context.fallbackLevel, "info");
  assert.equal(warning.context.effectiveLevel, "info");
  assertNoCredential(credentialMarker, JSON.stringify(warning));
}

async function verifyKeywordAndCanonicalInstall(
  command: readonly string[],
  directory: string,
  fixtureDirectory: string,
  installedStore: string,
): Promise<void> {
  const keywordHome = await createIsolatedHome(directory, "keyword-invalid-method");
  await writeConfig(keywordHome, "logging:\n  level: info\nquery:\n  retrievalMethod: invalid\n");

  const keyword = await run(command, directory, keywordHome, [
    "--json",
    "query",
    "Persisted retrieval demo",
    "--mode",
    "keyword",
    "--store-root",
    installedStore,
  ]);
  assert.equal(keyword.exitCode, 0);
  assert.equal(keyword.stderr, "");
  const keywordEnvelope = parseSingleResponse(keyword.stdout);
  assertV2SuccessEnvelope(keywordEnvelope, "query");
  const keywordData = requireSuccessData(keywordEnvelope, "query");
  assert.equal(keywordData.mode, "keyword");
  assert(Array.isArray(keywordData.results));
  assert(
    keywordData.results.some(
      (result) => isRecord(result) && result.practiceId === "integration.retrieval.demo",
    ),
  );

  const semantic = await run(command, directory, keywordHome, [
    "--json",
    "query",
    "Persisted retrieval demo",
    "--mode",
    "semantic",
    "--store-root",
    installedStore,
  ]);
  assert.equal(semantic.exitCode, 2);
  const semanticEnvelope = parseSingleResponse(semantic.stdout);
  assertV2FailureEnvelope(semanticEnvelope, "query", "query.config-invalid");
  assert.match(requiredError(semanticEnvelope).message, /query\.retrievalMethod/u);

  const installHome = await createIsolatedHome(directory, "pack-commit-invalid-method");
  await writeConfig(
    installHome,
    `logging:\n  level: ${JSON.stringify(credentialValue)}\nquery:\n  retrievalMethod: invalid\n`,
  );
  const installRoot = join(directory, "canonical-install-store");
  const install = await run(command, directory, installHome, [
    "--json",
    "pack",
    "install",
    "--path",
    join(fixtureDirectory, "fixture-pack"),
    "--store-root",
    installRoot,
  ]);
  assert.equal(install.exitCode, 0);
  const installEnvelope = parseSingleResponse(install.stdout);
  assertV2SuccessEnvelope(installEnvelope, "pack.install");
  assert.equal("error" in installEnvelope, false);
  const installNotices = install.stderr.split(/\r?\n/u).filter((line) => line.length > 0);
  assert.equal(installNotices.length, 2);
  assert.equal(installNotices[0], "index: sync failed; run lore index build for this Store");
  assertFallbackNotice(installNotices[1]!, installHome.configFile, "info");
  const installed = requireSuccessData(installEnvelope, "pack.install");
  assert(isRecord(installed.indexSync));
  assert.equal(installed.indexSync.state, "failed");
  assert(isRecord(installed.indexSync.error));
  assert.equal(installed.indexSync.error.code, "query.config-invalid");
  assert.match(String(installed.indexSync.error.message), /query\.retrievalMethod/u);
  assertNoCredential(credentialMarker, install.stdout, install.stderr);
  const contents = await readFile(installHome.configFile, "utf8");

  const list = await run(command, directory, installHome, [
    "--json",
    "pack",
    "list",
    "--store-root",
    installRoot,
  ]);
  assert.equal(list.exitCode, 0);
  assertFallbackNotice(list.stderr, installHome.configFile, "info");
  const listData = requireSuccessData(parseSingleResponse(list.stdout), "pack.list");
  assert(Array.isArray(listData.packs));
  assert(
    listData.packs.some((pack) => isRecord(pack) && pack.name === "integration-pack"),
    "canonical Pack install must remain visible after indexSync reports its config error",
  );
  assertNoCredential(credentialMarker, list.stdout, list.stderr);
  assert.equal(await readFile(installHome.configFile, "utf8"), contents);
}

async function verifyNormalLogging(
  command: readonly string[],
  directory: string,
  storageRoot: string,
): Promise<void> {
  const home = await createIsolatedHome(directory, "logging-valid");
  await writeConfig(home, "logging:\n  level: warn\n");
  const result = await run(command, directory, home, [
    "--json",
    "pack",
    "list",
    "--store-root",
    storageRoot,
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "", "valid logging configuration should not produce a notice");
  assertV2SuccessEnvelope(parseSingleResponse(result.stdout), "pack.list");
  assert.equal(await readFile(home.configFile, "utf8"), "logging:\n  level: warn\n");
}

async function readTrace(
  command: readonly string[],
  directory: string,
  home: IsolatedHome,
  traceId: string,
  causeKind: "setting" | "document" = "setting",
): Promise<{ readonly records: readonly unknown[] }> {
  const result = await run(command, directory, home, ["--json", "logs", "--trace-id", traceId]);
  assert.equal(result.exitCode, 0);
  const envelope = parseSingleResponse(result.stdout);
  const data = requireSuccessData(envelope, "logs");
  assert(Array.isArray(data.records));
  assertFallbackNotice(result.stderr, home.configFile, "info", causeKind);
  return { records: data.records };
}

function requireFallbackRecord(
  records: readonly unknown[],
  traceId: string,
  effectiveLevel: "info" | "debug",
): JsonRecord {
  const matches = records.filter(
    (record) => isRecord(record) && record.message === "logging.level-fallback",
  );
  assert.equal(matches.length, 1, "one fallback must be persisted for the selected trace");
  const warning = matches[0];
  assert(isRecord(warning));
  assert.equal(warning.level, "warn");
  assert.equal(warning.traceId, traceId);
  assert(isRecord(warning.context));
  assert.equal(warning.context.cause, "config");
  assert.equal(warning.context.fallbackLevel, "info");
  assert.equal(warning.context.effectiveLevel, effectiveLevel);
  return warning;
}

function assertFallbackNotice(
  stderr: string,
  configFile: string,
  effectiveLevel: "info" | "debug",
  causeKind: "setting" | "document" = "setting",
) {
  const lines = stderr.split(/\r?\n/u).filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `expected one fallback notice, got: ${JSON.stringify(stderr)}`);
  const notice = lines[0]!;
  assert.match(notice, /persistent logging level fell back to info/u);
  assert(notice.includes(`effective level is ${effectiveLevel}`));
  if (causeKind === "setting") {
    assert(notice.includes("logging.level"));
    assert.match(notice, /Correct or remove/u);
  } else {
    assert.match(notice, /Invalid YAML/u);
    assert.match(notice, /Correct the document syntax/u);
  }
  assert(notice.includes(configFile));
  assertNoCredential(credentialMarker, notice);
}

function assertV2SuccessEnvelope(response: JsonRecord, commandName: string): void {
  assert.equal(response.protocolVersion, 2);
  assert.equal(response.command, commandName);
  assert.equal(response.ok, true);
  assert.deepEqual(Object.keys(response).sort(), [
    "command",
    "data",
    "diagnostics",
    "ok",
    "protocolVersion",
    "toolVersion",
  ]);
  assert(isRecord(response.diagnostics));
  assert.deepEqual(Object.keys(response.diagnostics), ["traceId"]);
}

function assertV2FailureEnvelope(response: JsonRecord, commandName: string, code: string): void {
  assert.equal(response.protocolVersion, 2);
  requireFailureCode(response, commandName, code);
  assert.deepEqual(Object.keys(response).sort(), [
    "command",
    "diagnostics",
    "error",
    "ok",
    "protocolVersion",
    "toolVersion",
  ]);
  assert(isRecord(response.diagnostics));
  assert.deepEqual(Object.keys(response.diagnostics), ["traceId"]);
  assert.equal("notices" in response.diagnostics, false);
}

function requiredError(response: JsonRecord): { readonly code: string; readonly message: string } {
  assert(isRecord(response.error));
  assert.equal(typeof response.error.code, "string");
  assert.equal(typeof response.error.message, "string");
  return response.error as JsonRecord & { readonly code: string; readonly message: string };
}

function traceIdOf(response: JsonRecord): string {
  assert(isRecord(response.diagnostics));
  assert(typeof response.diagnostics.traceId === "string");
  return response.diagnostics.traceId;
}

async function createIsolatedHome(directory: string, name: string): Promise<IsolatedHome> {
  const requested = join(directory, name);
  await mkdir(requested, { recursive: true });
  const home = await realpath(requested);
  const configDirectory = join(home, ".lorelum");
  await mkdir(configDirectory, { recursive: true });

  const environment: Record<string, string | undefined> = { ...process.env };
  delete environment.LORELUM_BACKEND_STARTUP_TIMEOUT_MS;
  delete environment.LORELUM_BACKEND_REQUEST_TIMEOUT_MS;
  delete environment.LORELUM_BACKEND_SHUTDOWN_TIMEOUT_MS;
  delete environment.LORELUM_HOST_KEY;
  delete environment.LORELUM_HOST_SESSION_ID;
  Object.assign(environment, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
  });
  return {
    directory: home,
    configFile: join(configDirectory, "config.yaml"),
    environment,
  };
}

async function writeConfig(home: IsolatedHome, contents: string): Promise<void> {
  await writeFile(home.configFile, contents, "utf8");
}

async function run(
  command: readonly string[],
  directory: string,
  home: IsolatedHome,
  args: readonly string[],
  input?: string,
) {
  return runProcess([...command, ...args], timeoutMs, input, {
    environment: home.environment,
    cwd: directory,
  });
}

function assertNoCredential(marker: string, ...values: readonly string[]): void {
  for (const value of values) {
    assert.equal(value.includes(marker), false);
    assert.equal(value.includes(credentialValue), false);
  }
}
