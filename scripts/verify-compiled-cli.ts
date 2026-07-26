import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import cliManifest from "../packages/cli/package.json";
import goldenResponses from "../packages/cli/src/output/protocol.fixture.json";
import { protocolResponseSchema } from "../packages/cli/src/output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
  type JsonSchema,
} from "../packages/cli/src/output/protocol-schema.js";

const childTimeoutMs = 30_000;

const [binary, expectedPlatform, expectedArchitecture] = process.argv.slice(2);
if (binary === undefined || expectedPlatform === undefined || expectedArchitecture === undefined) {
  throw new Error("Usage: bun scripts/verify-compiled-cli.ts <binary> <platform> <architecture>");
}
if (process.platform !== expectedPlatform || process.arch !== expectedArchitecture) {
  throw new Error("Runner platform or architecture does not match the CI matrix expectation.");
}

const describeGolden = goldenResponses.find((response) => response.command === "describe");
const invalidGolden = goldenResponses.find((response) => response.command === "unknown");
if (describeGolden === undefined || invalidGolden === undefined) {
  throw new Error("Protocol golden fixtures are incomplete.");
}

const directory = await mkdtemp(join(tmpdir(), "lorelum-binary-"));
try {
  const packDirectory = join(directory, "pack");
  const configPath = join(directory, "config.json");
  await mkdir(packDirectory);
  await writeFile(join(packDirectory, "pack.yaml"), "name: binary-pack\nversion: 1.0.0\n");
  await writeFile(configPath, '{"version":1}');

  assertGoldenEnvelope(await assertResponse([binary], 0, "describe"), asRecord(describeGolden));
  const version = await assertResponse([binary, "--version"], 0, "version");
  assertSuccess(version);
  if (
    version.toolVersion !== cliManifest.version ||
    data(version).toolVersion !== cliManifest.version
  ) {
    throw new Error("Compiled binary tool version does not match CLI package metadata.");
  }

  const describe = await assertResponse([binary, "describe", "validate"], 0, "describe");
  assertSuccess(describe);
  if (!Array.isArray(data(describe).exitCodes) || !data(describe).exitCodes.includes(1)) {
    throw new Error("Compiled binary does not describe validate's report exit code.");
  }
  const validateErrorCodes = asArray(data(describe).errorCodes);
  if (
    !validateErrorCodes.includes("config.path_invalid") ||
    !validateErrorCodes.includes("runtime.unexpected")
  ) {
    throw new Error("Compiled binary does not describe validate's runtime error boundary.");
  }
  const packPath = asRecord(asArray(data(describe).positionals)[0]);
  const securityModel = asRecord(asRecord(packPath.constraints).securityModel);
  if (
    securityModel.threatModel !== "trusted-local" ||
    securityModel.capabilityBoundary !== false ||
    securityModel.concurrentUntrustedMutation !== "unsupported"
  ) {
    throw new Error("Compiled binary does not describe validate's trusted-local boundary.");
  }
  const validateResultSchema = asRecord(data(describe).resultSchema) as JsonSchema;

  const config = await assertResponse(
    [binary, "--config", configPath, "config", "show"],
    0,
    "config.show",
  );
  assertSuccess(config);
  if (data(config).source !== "file" || asRecord(data(config).configuration).version !== 1) {
    throw new Error("Compiled binary did not load the explicit read-only configuration.");
  }

  const configPathResponse = await assertResponse(
    [binary, "--config", configPath, "config", "path"],
    0,
    "config.path",
  );
  assertSuccess(configPathResponse);
  if (
    data(configPathResponse).source !== "explicit" ||
    data(configPathResponse).path !== configPath
  ) {
    throw new Error("Compiled binary did not report the explicit configuration path.");
  }

  const valid = await assertResponse([binary, "validate", packDirectory], 0, "validate");
  assertSuccess(valid);
  assertJsonSchema(data(valid), validateResultSchema, "valid validation report");
  if (data(valid).valid !== true) throw new Error("Compiled binary rejected a valid pack.");

  await writeFile(
    join(packDirectory, "decisions.yaml"),
    "- id: binary.entry\n  question: What next?\n  branches:\n    - when: always\n      recommend: [binary.missing]\n      reason: Exercise validation failure\n",
  );
  const invalidPack = await assertResponse([binary, "validate", packDirectory], 1, "validate");
  assertSuccess(invalidPack);
  assertJsonSchema(data(invalidPack), validateResultSchema, "invalid validation report");
  if (
    data(invalidPack).valid !== false ||
    !asArray(data(invalidPack).errors).some((issue) => asRecord(issue).code === "dangling-ref")
  ) {
    throw new Error("Compiled binary did not return the expected validation report.");
  }

  const lenient = await assertResponse(
    [binary, "validate", packDirectory, "--lenient"],
    0,
    "validate",
  );
  assertSuccess(lenient);
  assertJsonSchema(data(lenient), validateResultSchema, "lenient validation report");
  if (data(lenient).valid !== false)
    throw new Error("Lenient validation changed the report content.");

  const invalid = await run([binary, "--private-token"]);
  if (invalid.exitCode !== 2 || invalid.stderr !== "" || invalid.stdout.includes("private-token")) {
    throw new Error("Invalid invocation did not preserve the public protocol boundary.");
  }
  assertGoldenEnvelope(assertEnvelope(invalid.stdout, "unknown"), asRecord(invalidGolden));
} finally {
  await rm(directory, { force: true, recursive: true });
}

async function assertResponse(
  command: string[],
  exitCode: number,
  expectedCommand: string,
): Promise<Record<string, unknown>> {
  const response = await run(command);
  if (response.exitCode !== exitCode || response.stderr !== "") {
    throw new Error(`Compiled binary fixture failed for ${expectedCommand}.`);
  }
  return assertEnvelope(response.stdout, expectedCommand);
}

function assertEnvelope(stdout: string, expectedCommand: string): Record<string, unknown> {
  const lines = stdout.trimEnd().split("\n");
  if (lines.length !== 1)
    throw new Error("Compiled binary wrote more than one stdout protocol line.");

  let envelope: unknown;
  try {
    envelope = JSON.parse(lines[0] ?? "");
  } catch {
    throw new Error("Compiled binary stdout is not JSON.");
  }
  const schemaErrors = validateProtocolSchema(envelope, protocolResponseSchema);
  if (schemaErrors.length > 0) {
    throw new Error(
      `Compiled binary response violates protocol schema: ${schemaErrors.join("; ")}`,
    );
  }

  const record = asRecord(envelope);
  if (record.command !== expectedCommand)
    throw new Error("Compiled binary response has an unexpected command.");
  if (record.toolVersion !== cliManifest.version) {
    throw new Error("Compiled binary response version does not match CLI package metadata.");
  }
  return record;
}

function assertGoldenEnvelope(
  envelope: Record<string, unknown>,
  golden: Record<string, unknown>,
): void {
  for (const property of ["protocolVersion", "toolVersion", "command", "ok"]) {
    if (envelope[property] !== golden[property]) {
      throw new Error(
        `Compiled binary response diverges from the ${String(property)} golden fixture.`,
      );
    }
  }
}

function assertSuccess(envelope: Record<string, unknown>): void {
  if (envelope.ok !== true) throw new Error("Compiled binary returned a failure envelope.");
}

function assertJsonSchema(value: unknown, schema: JsonSchema, fixture: string): void {
  const errors = validateJsonSchema(value, schema);
  if (errors.length > 0) {
    throw new Error(
      `Compiled binary ${fixture} violates its discovered schema: ${errors.join("; ")}`,
    );
  }
}

function data(envelope: Record<string, unknown>): Record<string, unknown> {
  return asRecord(envelope.data);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Compiled binary response has an invalid object field.");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Compiled binary response has an invalid array field.");
  return value;
}

async function run(command: string[]) {
  const child = Bun.spawn({ cmd: command, stderr: "pipe", stdout: "pipe" });
  const output = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Compiled CLI process exceeded ${childTimeoutMs}ms.`));
    }, childTimeoutMs);
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.race([output, deadline]);
    return { exitCode, stderr, stdout };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
