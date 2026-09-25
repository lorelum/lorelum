import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isInternalBackendDaemonLaunch, isInternalBackendServeInvocation, run } from "./main.js";
import { protocolResponseSchema, toolVersion, type JsonSchema } from "./output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "./output/protocol-schema.test-helper.js";
import { describeCommand } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
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
    protocolVersion: 3,
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
  expect(version.value).toBe(`Lorelum ${toolVersion} (protocol 3)\n`);

  expect(
    await run(["--version", "--json"], {
      stdout: jsonVersion,
      traceId: "00000000-0000-4000-8000-000000000001" as never,
    }),
  ).toBe(0);
  const versionResponse = JSON.parse(jsonVersion.value);
  expect(versionResponse).toEqual({
    protocolVersion: 3,
    toolVersion,
    command: "version",
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000001" },
    ok: true,
    data: { protocolVersion: 3, toolVersion },
  });
  expect(validateProtocolSchema(versionResponse, protocolResponseSchema)).toEqual([]);
  const versionResultSchema = optionResultSchemaFor("lore", "version");
  expect(validateJsonSchema(versionResponse.data, versionResultSchema)).toEqual([]);
  expect(validateJsonSchema({ protocolVersion: 3 }, versionResultSchema)).not.toEqual([]);
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
        error: { code: "usage.invalid", message: "The command invocation is invalid." },
      });
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
  message: The command invocation is invalid.
diagnostics:
  traceId: 00000000-0000-4000-8000-000000000004
`);
});

test.skipIf(process.platform === "win32")(
  "a widened 0755 log root is self-healed and the failure envelope reports it",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-envelope-"));
    const lorelum = join(home, ".lorelum");
    const root = join(lorelum, "logs");
    try {
      await mkdir(join(root, "cli"), { recursive: true });
      await chmod(lorelum, 0o755);
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(["query", "   ", "--json"], { stdout, stderr, logDirectory: root })).toBe(2);
      const response = JSON.parse(stdout.value);
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("usage.invalid");
      expect(response.protocolVersion).toBe(3);
      expect(response.diagnostics.logPersistence).toMatchObject({
        persisted: true,
        fallbackUsed: false,
      });
      expect(response.diagnostics.logPersistence.repairs?.length).toBeGreaterThanOrEqual(1);
      expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
      // The override root is its own trusted boundary: the walk starts there.
      expect((await lstat(root)).mode & 0o077).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a healthy log root keeps the success envelope quiet about persistence",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-quiet-"));
    const root = join(home, ".lorelum", "logs");
    try {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();
      expect(await run(["--json"], { stdout, stderr, logDirectory: root })).toBe(0);
      const response = JSON.parse(stdout.value);
      expect(response.ok).toBe(true);
      expect(response.diagnostics.logPersistence).toBeUndefined();
      expect(stderr.value).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "an unrepairable root diverts to the fallback and the success envelope says so",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-divert-"));
    const root = join(home, ".lorelum", "logs");
    const fallback = join(home, ".lorelum-diagnostics");
    try {
      const decoy = join(home, "decoy");
      await writeFile(decoy, "preserve me", "utf8");
      await mkdir(join(home, ".lorelum"), { recursive: true });
      await symlink(decoy, root);
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(
        await run(["--json"], {
          stdout,
          stderr,
          logDirectory: root,
          fallbackLogDirectory: fallback,
        }),
      ).toBe(0);
      const response = JSON.parse(stdout.value);
      expect(response.ok).toBe(true);
      expect(response.diagnostics.logPersistence).toMatchObject({
        persisted: true,
        fallbackUsed: true,
      });
      expect(response.diagnostics.logPersistence.usedPath).toContain(fallback);
      expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
      expect(await Bun.file(decoy).text()).toBe("preserve me");
      expect(stderr.value).toContain("lore diagnostics: diverted to the diagnostics fallback");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a text success surfaces the self-heal notice only on stderr",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-text-heal-"));
    const root = join(home, ".lorelum", "logs");
    try {
      await mkdir(join(root, "cli"), { recursive: true });
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run([], { stdout, stderr, logDirectory: root })).toBe(0);
      expect(stdout.value).not.toContain("lore diagnostics");
      expect(stderr.value).toContain("lore diagnostics: log location self-healed");
      expect((await lstat(root)).mode & 0o077).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "text failures keep showing the trace with the persistence facts",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-text-"));
    const lorelum = join(home, ".lorelum");
    const root = join(lorelum, "logs");
    try {
      await mkdir(join(root, "cli"), { recursive: true });
      await chmod(lorelum, 0o755);
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(["query", "   "], { stdout, stderr, logDirectory: root })).toBe(2);
      expect(stdout.value).toBe("");
      expect(stderr.value).toContain("usage.invalid");
      expect(stderr.value).toContain("traceId:");
      expect(stderr.value).toContain("logPersistence:");
      expect(stderr.value).toContain("persisted: true");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a diverted hook keeps its raw stdout ABI and notices only on stderr",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-hook-"));
    const root = join(home, ".lorelum", "logs");
    const fallback = join(home, ".lorelum-diagnostics");
    try {
      const decoy = join(home, "decoy");
      await writeFile(decoy, "preserve me", "utf8");
      await mkdir(join(home, ".lorelum"), { recursive: true });
      await symlink(decoy, root);
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(
        await run(["hook", "codex"], {
          stdin: { text: async () => '{"hook_event_name":"PostCompact"}' },
          stdout,
          stderr,
          logDirectory: root,
          fallbackLogDirectory: fallback,
        }),
      ).toBe(0);
      expect(stdout.value).toBe('{"continue":true}\n');
      expect(stderr.value).toMatch(/lore hook codex degraded: /);
      expect(stderr.value).toMatch(/lore diagnostics: diverted to the diagnostics fallback/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
