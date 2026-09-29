import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isInternalBackendDaemonLaunch, isInternalBackendServeInvocation, run } from "./main.js";
import { protocolResponseSchema, toolVersion, type JsonSchema } from "./output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "./output/protocol-schema.test-helper.js";
import { commandRegistry, describeCommand } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

interface CliProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCliProcess(arguments_: string[], home: string): Promise<CliProcessResult> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts"), ...arguments_], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test("recognizes only the exact private backend daemon invocation", () => {
  expect(isInternalBackendServeInvocation(["--internal-backend-serve"])).toBe(true);
  expect(isInternalBackendServeInvocation([])).toBe(false);
  expect(isInternalBackendServeInvocation(["--internal-backend-serve", "extra"])).toBe(false);
  expect(isInternalBackendServeInvocation(["backend", "start"])).toBe(false);
});

test("requires private lifecycle environment before entering the backend daemon", () => {
  const args = ["--internal-backend-serve"];
  expect(isInternalBackendDaemonLaunch(args, {})).toBe(false);
  expect(
    isInternalBackendDaemonLaunch(args, {
      LORELUM_BACKEND_DIRECTORY: "/tmp/lorelum",
      LORELUM_BACKEND_INSTANCE: "instance",
      LORELUM_BACKEND_PORT: "26186",
    }),
  ).toBe(true);
});

test("returns machine-readable root capability discovery when explicitly requested", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run(["--json"], { stderr, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    protocolVersion: 2,
    toolVersion,
    command: "describe",
    ok: true,
    data: {
      name: "lore",
      commands: [
        { name: "describe" },
        { name: "pack.install" },
        { name: "pack.update" },
        { name: "registry.add" },
        { name: "registry.list" },
        { name: "registry.remove" },
        { name: "registry.set-default" },
        { name: "pack.remove" },
        { name: "get" },
        { name: "init" },
        { name: "context.status" },
        { name: "cache.status" },
        { name: "cache.prune" },
        { name: "logs" },
        { name: "feedback.draft" },
        { name: "query" },
        { name: "pack.list" },
        { name: "backend.start" },
        { name: "backend.status" },
        { name: "backend.stop" },
        { name: "backend.lease.acquire" },
        { name: "backend.lease.renew" },
        { name: "backend.lease.release" },
        { name: "model.load" },
        { name: "model.status" },
        { name: "model.unload" },
        { name: "index.status" },
        { name: "index.build" },
        { name: "index.rebuild" },
        { name: "index.operation" },
        { name: "format" },
        { name: "i18n.sync" },
        { name: "validate" },
      ],
    },
  });
  expect(stderr.value).toBe("");
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, resultSchemaFor("lore"))).toEqual([]);
  expect(
    validateJsonSchema({ ...response.data, commands: "describe" }, resultSchemaFor("lore")),
  ).not.toEqual([]);
});

test("returns command metadata through describe", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["describe", "describe", "--json"], { stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "describe",
      resultSchema: { oneOf: expect.any(Array) },
      errorCodes: ["usage.invalid", "runtime.unexpected"],
      exitCodes: [0, 2],
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, resultSchemaFor("describe"))).toEqual([]);
  expect(
    validateJsonSchema({ ...response.data, exitCodes: ["0", "2"] }, resultSchemaFor("describe")),
  ).not.toEqual([]);
});

function resultSchemaFor(command: string): JsonSchema {
  const description = describeCommand(command) as { resultSchema?: JsonSchema } | undefined;
  if (description?.resultSchema === undefined) {
    throw new Error(`Missing result schema for ${command}`);
  }
  return description.resultSchema;
}

function optionResultSchemaFor(command: string, behavior: string): JsonSchema {
  const description = describeCommand(command) as
    | {
        options?: readonly {
          behavior?: string;
          response?: { resultSchema?: JsonSchema };
        }[];
      }
    | undefined;
  const schema = description?.options?.find((option) => option.behavior === behavior)?.response
    ?.resultSchema;
  if (schema === undefined) {
    throw new Error(`Missing ${behavior} result schema for ${command}`);
  }
  return schema;
}

test("uses readable Help and version by default while preserving explicit JSON", async () => {
  const help = new MemoryWriter();
  const version = new MemoryWriter();
  const jsonHelp = new MemoryWriter();
  const jsonVersion = new MemoryWriter();

  expect(await run(["describe", "--help"], { stdout: help })).toBe(0);
  expect(help.value).toContain("Usage: describe [command]");
  expect(help.value).toContain("Complete command contract:");
  expect(help.value).toContain("resultSchema:");
  expect(help.value).toContain("errorCodes:");
  expect(help.value).toContain("exitCodes:");

  expect(await run(["describe", "--help", "--json"], { stdout: jsonHelp })).toBe(0);
  expect(JSON.parse(jsonHelp.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: { name: "describe" },
  });
  expect(validateProtocolSchema(JSON.parse(jsonHelp.value), protocolResponseSchema)).toEqual([]);

  expect(await run(["--version"], { stdout: version })).toBe(0);
  expect(version.value).toBe(`Lorelum ${toolVersion} (protocol 2)\n`);

  expect(
    await run(["--version", "--json"], {
      stdout: jsonVersion,
      traceId: "00000000-0000-4000-8000-000000000001" as never,
    }),
  ).toBe(0);
  const versionResponse = JSON.parse(jsonVersion.value);
  expect(versionResponse).toEqual({
    protocolVersion: 2,
    toolVersion,
    command: "version",
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000001" },
    ok: true,
    data: { protocolVersion: 2, toolVersion },
  });
  expect(validateProtocolSchema(versionResponse, protocolResponseSchema)).toEqual([]);
  const versionResultSchema = optionResultSchemaFor("lore", "version");
  expect(validateJsonSchema(versionResponse.data, versionResultSchema)).toEqual([]);
  expect(validateJsonSchema({ protocolVersion: 2 }, versionResultSchema)).not.toEqual([]);
});

test("accepts the documented equals form of global options", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["--json", "--log-level=debug"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "describe", ok: true });
});

test("validates invalid calls before help and version responses", async () => {
  const invalidCalls = [
    ["unknown", "--help"],
    ["describe", "unknown", "--help"],
    ["unknown", "--version"],
    ["--help", "--version"],
    ["describe", "--version"],
    ["--log-level"],
    ["--store-root"],
    ["pack", "install", "agentic-coding", "--store-root="],
    ["--private-token"],
  ];
  await Promise.all(
    invalidCalls.map(async (args) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(["--json", ...args], { stderr, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        ok: false,
        error: { code: "usage.invalid", message: expect.any(String) },
      });
      expect(JSON.parse(stdout.value).error.details).toBeUndefined();
      expect(JSON.parse(stdout.value).error.message).not.toBe("The command invocation is invalid.");
      expect(stdout.value).not.toContain("private-token");
      expect(stderr.value).toBe("");
      expect(stderr.value).not.toContain("private-token");
      expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
    }),
  );
});

test("writes default failures to stderr as complete text", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(
    await run(["unknown"], {
      stderr,
      stdout,
      traceId: "00000000-0000-4000-8000-000000000004" as never,
    }),
  ).toBe(2);
  expect(stdout.value).toBe("");
  expect(stderr.value).toBe(`error:
  code: usage.invalid
  message: Unknown command or extra argument. Run lore --help to see valid arguments.
diagnostics:
  traceId: 00000000-0000-4000-8000-000000000004
`);
});

test("every registered command has one actionable message for invalid invocation", async () => {
  for (const definition of commandRegistry) {
    const command = definition.name.split(".");
    const args = [...command, "--not-a-lore-option"];
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    expect(await run(["--json", ...args], { stdout, stderr })).toBe(2);
    const response = JSON.parse(stdout.value);
    expect(response).toMatchObject({
      ok: false,
      error: { code: "usage.invalid" },
    });
    const message = response.error.message as string;
    expect(message).toContain(`Run lore ${command.join(" ")} --help to see valid arguments.`);
    expect(message).not.toBe("The command invocation is invalid.");
    expect(Object.keys(response.error)).toEqual(["code", "message"]);
    expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);

    const text = new MemoryWriter();
    expect(await run(args, { stdout: new MemoryWriter(), stderr: text })).toBe(2);
    expect(text.value).toContain(`message: ${message}`);
  }
});

test.each([
  {
    args: ["query", "text", "--mode", "private-token"],
    message: "--mode must be one of: semantic, keyword.",
  },
  {
    args: ["logs", "--level", "private-token"],
    message: "--level must be one of: error, warn, info, debug.",
  },
  {
    args: ["--log-level", "private-token"],
    message: "--log-level must be one of: error, warn, info, debug.",
  },
  {
    args: ["logs", "private-token"],
    message: "<action> must be one of: prune.",
  },
])("uses registry choices in parser errors for $args", async ({ args, message }) => {
  const stdout = new MemoryWriter();
  expect(await run(["--json", ...args], { stdout })).toBe(2);
  const response = JSON.parse(stdout.value);
  expect(response.error).toEqual({ code: "usage.invalid", message });
  expect(stdout.value).not.toContain("private-token");
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);

  const stderr = new MemoryWriter();
  expect(await run([...args], { stderr })).toBe(2);
  expect(stderr.value).toContain(`message: ${message}`);
  expect(stderr.value).not.toContain("private-token");
});

test("long dynamic command choices identify the positional without echoing input", async () => {
  const stdout = new MemoryWriter();
  expect(await run(["describe", "private-token", "--json"], { stdout })).toBe(2);
  const response = JSON.parse(stdout.value);
  expect(response.error).toEqual({
    code: "usage.invalid",
    message: "<command> must be an allowed value. Run lore describe --help to see valid choices.",
  });
  expect(stdout.value).not.toContain("private-token");
});

test.each([
  { args: ["get", "bad-id"], message: "Practice ID" },
  { args: ["pack", "install", "BadName"], message: "Pack name" },
  { args: ["pack", "list", "bad.name"], message: "Pack name" },
  { args: ["pack", "remove", "bad.name"], message: "Pack name" },
  { args: ["logs", "--limit", "1001"], message: "--limit must be an integer from 1 through 1000" },
  { args: ["feedback", "draft"], message: "exactly one of --trace-id or --input" },
  {
    args: ["backend", "lease", "acquire", "--ttl-ms", "0"],
    message: "--ttl-ms must be an integer from 1000 through 300000",
  },
  {
    args: ["query", "text", "--require-complete", "--min-coverage-percent", "1"],
    message: "Use --require-complete or --min-coverage-percent",
  },
])("retains validator-owned correction for $args", async ({ args, message }) => {
  const stdout = new MemoryWriter();
  expect(await run(["--json", ...args], { stdout })).toBe(2);
  const response = JSON.parse(stdout.value);
  expect(response.error).toEqual({
    code: "usage.invalid",
    message: expect.stringContaining(message),
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);

  const stderr = new MemoryWriter();
  expect(await run([...args], { stderr })).toBe(2);
  expect(stderr.value).toContain(`message: ${response.error.message}`);
});

test("returns a query option's valid range in one message in both formats", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(
    await run(["--json", "query", "release validation", "--min-coverage-percent", "101"], {
      stderr,
      stdout,
    }),
  ).toBe(2);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    protocolVersion: 2,
    command: "query",
    ok: false,
    error: {
      code: "usage.invalid",
      message: "--min-coverage-percent must be an integer from 0 through 100.",
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);

  const textStdout = new MemoryWriter();
  const textStderr = new MemoryWriter();
  expect(
    await run(["query", "release validation", "--min-coverage-percent", "101"], {
      stderr: textStderr,
      stdout: textStdout,
    }),
  ).toBe(2);
  expect(textStdout.value).toBe("");
  expect(textStderr.value).toContain("code: usage.invalid");
  expect(textStderr.value).toContain(
    "  message: --min-coverage-percent must be an integer from 0 through 100.\n",
  );
});

test("negative integer query options show the accepted range", async () => {
  await Promise.all(
    (
      [
        ["--max-wait-ms", 120_000],
        ["--min-coverage-percent", 100],
      ] as const
    ).map(async ([option, max]) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(
        await run(["--json", "query", "release validation", option, "-1"], { stderr, stdout }),
      ).toBe(2);
      expect(JSON.parse(stdout.value).error).toEqual({
        code: "usage.invalid",
        message: `${option} must be an integer from 0 through ${max}.`,
      });
      expect(stderr.value).toBe("");
    }),
  );
});

test("returns a configuration repair target in one message in both formats", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-error-messages-"));
  await mkdir(join(home, ".lorelum"));
  await writeFile(join(home, ".lorelum", "config.yaml"), "query:\n  maxWaitMs: nope\n");
  try {
    // os.homedir() consults the environment only at process start on some
    // platforms, so the isolated HOME must be given to a real child process.
    const json = await runCliProcess(["--json", "query", "release validation"], home);
    expect(json.exitCode).toBe(2);
    const response = JSON.parse(json.stdout);
    expect(response).toMatchObject({
      protocolVersion: 2,
      command: "query",
      ok: false,
      error: {
        code: "query.config-invalid",
        message:
          "query.maxWaitMs must be an integer from 0 through 120000. Fix or remove it in ~/.lorelum/config.yaml.",
      },
    });
    expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);

    const text = await runCliProcess(["query", "release validation"], home);
    expect(text.exitCode).toBe(2);
    expect(text.stdout).toBe("");
    expect(text.stderr).toContain("code: query.config-invalid");
    expect(text.stderr).toContain(
      "  message: query.maxWaitMs must be an integer from 0 through 120000. Fix or remove it in ~/.lorelum/config.yaml.\n",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
