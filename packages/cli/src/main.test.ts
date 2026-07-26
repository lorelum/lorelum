import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { run } from "./main.js";
import { protocolResponseSchema, toolVersion } from "./output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
  type JsonSchema,
} from "./output/protocol-schema.js";
import { describeCommand } from "./registry.js";
import { createRuntime } from "./runtime/runtime.js";
import { PackLoadError, type PackLoader } from "@lorelum/engine";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("returns machine-readable root capability discovery", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run([], { stderr, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: { name: "lore" },
  });
  expect(
    JSON.parse(stdout.value).data.commands.map((command: { name: string }) => command.name),
  ).toEqual(
    expect.arrayContaining(["describe", "config", "config.path", "config.show", "validate"]),
  );
  expect(stderr.value).toBe("");
  expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
  const rootSchema = (describeCommand("lore") as { resultSchema: JsonSchema }).resultSchema;
  expect(validateJsonSchema(JSON.parse(stdout.value).data, rootSchema)).toEqual([]);
});

test("returns command metadata through describe", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["describe", "describe"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "describe",
      resultSchema: { oneOf: expect.any(Array) },
      errorCodes: expect.arrayContaining(["usage.invalid", "runtime.unexpected"]),
      exitCodes: [0, 2],
    },
  });
  expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
  const discoverySchema = (describeCommand("describe") as { resultSchema: JsonSchema })
    .resultSchema;
  expect(validateJsonSchema(JSON.parse(stdout.value).data, discoverySchema)).toEqual([]);
});

test("returns structured help and version responses", async () => {
  const help = new MemoryWriter();
  const version = new MemoryWriter();

  expect(await run(["describe", "--help"], { stdout: help })).toBe(0);
  expect(JSON.parse(help.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: { name: "describe" },
  });
  expect(validateProtocolSchema(JSON.parse(help.value), protocolResponseSchema)).toEqual([]);

  expect(await run(["--version"], { stdout: version })).toBe(0);
  expect(JSON.parse(version.value)).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "version",
    ok: true,
    data: { protocolVersion: 1, toolVersion },
  });
  expect(validateProtocolSchema(JSON.parse(version.value), protocolResponseSchema)).toEqual([]);
});

test("accepts the documented equals form of global options", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["--log-level=debug"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "describe", ok: true });
});

test("validates invalid calls before help and version responses", async () => {
  const invalidCalls = [
    ["unknown", "--help"],
    ["describe", "unknown", "--help"],
    ["unknown", "--version"],
    ["--log-level"],
    ["--private-token"],
  ];
  await Promise.all(
    invalidCalls.map(async (args) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(args, { stderr, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        ok: false,
        error: { code: "usage.invalid", message: "The command invocation is invalid." },
      });
      expect(stdout.value).not.toContain("private-token");
      expect(stderr.value).toBe("");
      expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
    }),
  );
});

test("reports deterministic local configuration paths and defaults", async () => {
  const stdout = new MemoryWriter();
  const runtime = createRuntime({
    env: { XDG_CONFIG_HOME: "/home/agent/.config-root" },
    homeDirectory: "/ignored",
    platform: "linux",
  });

  expect(await run(["config", "path"], { runtime, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "config.path",
    ok: true,
    data: { path: "/home/agent/.config-root/lorelum/config.json", source: "default" },
  });

  const show = new MemoryWriter();
  const missingRuntime = createRuntime({
    env: { LORELUM_CONFIG: "/tmp/lorelum-config-does-not-exist.json" },
    platform: "linux",
  });
  expect(await run(["config", "show"], { runtime: missingRuntime, stdout: show })).toBe(2);
  expect(JSON.parse(show.value)).toMatchObject({
    command: "config.show",
    ok: false,
    error: { code: "config.unreadable" },
  });
});

test("loads an explicitly selected configuration through the CLI boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
  const path = join(directory, "config.json");
  await writeFile(path, '{"version":1}');
  const stdout = new MemoryWriter();

  try {
    expect(await run([`--config=${path}`, "config", "show"], { stdout })).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "config.show",
      ok: true,
      data: { configuration: { version: 1 }, source: "file" },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects relative config overrides through the CLI boundary", async () => {
  const stdout = new MemoryWriter();

  expect(
    await run(["--config=relative.json", "config", "path"], {
      createRuntime: (options) => createRuntime({ ...options, platform: "linux" }),
      stdout,
    }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "config.path",
    ok: false,
    error: { code: "config.path_invalid" },
  });
});

test("describes validate as a public command with its report contract", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["describe", "validate"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "validate",
      positionals: [
        {
          name: "pack-path",
          required: true,
          constraints: {
            kind: "directory",
            layoutVersion: 1,
            maxInputFiles: 128,
            maxPracticeBytesTotal: 4 * 1024 * 1024,
            inputs: {
              pack: { path: "pack.yaml", required: true, maxBytes: 64 * 1024 },
              decisions: { path: "decisions.yaml", required: false, maxBytes: 256 * 1024 },
              practices: {
                path: "practices/*.md",
                required: false,
                recursive: false,
                maxBytesEach: 512 * 1024,
              },
            },
            symlinks: "rejected",
            securityModel: {
              threatModel: "trusted-local",
              capabilityBoundary: false,
              concurrentUntrustedMutation: "unsupported",
            },
          },
        },
      ],
      options: expect.arrayContaining([expect.objectContaining({ name: "--lenient" })]),
      resultSchema: { oneOf: expect.any(Array) },
      errorCodes: expect.arrayContaining([
        "config.path_invalid",
        "runtime.unexpected",
        "pack.parse_error",
      ]),
      exitCodes: [0, 1, 2],
    },
  });
});

function runtimeForPack(packLoader: PackLoader) {
  return createRuntime({ packLoader });
}

test("returns validation reports on stdout and uses exit 1 only for invalid loaded packs", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPack({
    async load() {
      return {
        pack: { name: "test-pack", version: "1.0.0" },
        practices: [],
        decisions: [
          {
            id: "test.entry",
            question: "What now?",
            branches: [
              { when: "always", recommend: ["test.missing"], reason: "exercise an error" },
            ],
          },
        ],
      };
    },
  });

  expect(await run(["validate", "ignored"], { runtime, stdout })).toBe(1);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "validate",
    ok: true,
    data: { valid: false, errors: [expect.objectContaining({ code: "dangling-ref" })] },
  });
  const report = JSON.parse(stdout.value).data;
  const resultSchema = (describeCommand("validate") as { resultSchema: JsonSchema }).resultSchema;
  expect(validateJsonSchema(report, resultSchema)).toEqual([]);
  expect(validateJsonSchema({ ...report, errors: "invalid" }, resultSchema)).not.toEqual([]);
  expect(
    validateJsonSchema(
      {
        ...report,
        errors: report.errors.map((issue: { level: string }) => ({ ...issue, level: "warning" })),
      },
      resultSchema,
    ),
  ).not.toEqual([]);
  expect(validateJsonSchema({ ...report, valid: true }, resultSchema)).not.toEqual([]);
  expect(validateJsonSchema({ ...report, valid: false, errors: [] }, resultSchema)).not.toEqual([]);
});

test("keeps report content but permits local lenient validation", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPack({
    async load() {
      return {
        pack: { name: "test-pack", version: "1.0.0" },
        practices: [],
        decisions: [
          {
            id: "test.entry",
            question: "What now?",
            branches: [
              { when: "always", recommend: ["test.missing"], reason: "exercise an error" },
            ],
          },
        ],
      };
    },
  });

  expect(await run(["validate", "ignored", "--lenient"], { runtime, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "validate",
    ok: true,
    data: { valid: false },
  });
});

test("normalizes pack loader failures to a failure envelope", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPack({
    async load() {
      throw new PackLoadError("pack.parse_error", "A pack document could not be parsed.");
    },
  });

  expect(await run(["validate", "ignored"], { runtime, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "validate",
    ok: false,
    error: { code: "pack.parse_error", message: "A pack document could not be parsed." },
  });
});

test("advertises the unexpected runtime error that validate can return", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPack({
    async load() {
      throw new Error("internal detail");
    },
  });

  expect(await run(["validate", "ignored"], { runtime, stdout })).toBe(2);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "validate",
    ok: false,
    error: { code: "runtime.unexpected", message: "The command could not be completed." },
  });
  expect((describeCommand("validate") as { errorCodes: string[] }).errorCodes).toContain(
    response.error.code,
  );
});

test("resolves a relative pack path at the CLI runtime boundary", async () => {
  let receivedPath = "";
  const runtime = createRuntime({
    workingDirectory: "/controlled/cwd",
    packLoader: {
      async load(path) {
        receivedPath = path;
        return { pack: { name: "test-pack", version: "1.0.0" }, practices: [], decisions: [] };
      },
    },
  });

  expect(await run(["validate", "relative-pack"], { runtime, stdout: new MemoryWriter() })).toBe(0);
  expect(receivedPath).toBe(resolve("/controlled/cwd", "relative-pack"));
});
