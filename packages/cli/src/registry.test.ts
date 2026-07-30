import { expect, test } from "bun:test";

import { createProgram } from "./create-program.js";
import { run } from "./main.js";
import {
  commandRegistry,
  describeCommand,
  snapshotCommandDefinitions,
  type CommandDefinition,
} from "./registry.js";
import { CliError, cliErrorCodes, frameworkErrorCodes } from "./runtime/errors.js";
import { Logger } from "./runtime/logger.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const futureCommand: CommandDefinition = {
  name: "future",
  summary: "Temporary registry regression command.",
  positionals: [],
  options: [
    {
      longFlag: "--future-mode",
      description: "Exercise command-specific option registration.",
      value: { name: "mode", required: true },
      optionRequired: true,
      values: ["safe"],
    },
  ],
  resultSchema: { type: "object" },
  errorCodes: frameworkErrorCodes,
  exitCodes: [0, 2],
  handler: async (invocation) => {
    await Promise.resolve();
    return { data: { mode: invocation.options.futureMode } };
  },
};

test("exposes an immutable production command registry", () => {
  expect(Object.isFrozen(commandRegistry)).toBe(true);
  expect(Object.isFrozen(commandRegistry[0])).toBe(true);
  expect(Object.isFrozen(commandRegistry[0]?.positionals)).toBe(true);
  expect(Object.isFrozen(commandRegistry[0]?.resultSchema)).toBe(true);
});

test("rejects command metadata that omits framework errors or exit codes", () => {
  expect(() =>
    snapshotCommandDefinitions([{ ...futureCommand, errorCodes: [cliErrorCodes.usageInvalid] }]),
  ).toThrow(cliErrorCodes.runtimeUnexpected);
  expect(() => snapshotCommandDefinitions([{ ...futureCommand, exitCodes: [0] }])).toThrow(
    "exit code 2",
  );
});

test("rejects registry definitions that would make parser metadata ambiguous", () => {
  expect(() => snapshotCommandDefinitions([futureCommand, futureCommand])).toThrow(
    'Command name "future" is declared more than once.',
  );
  expect(() =>
    snapshotCommandDefinitions([
      futureCommand,
      {
        ...futureCommand,
        name: "nested",
        positionals: [{ name: "target", required: false }],
        options: [],
      },
      { ...futureCommand, name: "nested.child", options: [] },
    ]),
  ).toThrow("cannot combine local arguments with child commands");
  expect(() =>
    snapshotCommandDefinitions([
      {
        ...futureCommand,
        name: "conflicting-option",
        options: [
          {
            longFlag: "--log-level",
            description: "Conflict.",
            value: { name: "level", required: true },
            optionRequired: false,
          },
        ],
      },
    ]),
  ).toThrow('conflicting option "--log-level"');
  expect(() =>
    snapshotCommandDefinitions([
      {
        ...futureCommand,
        name: "conflicting-short-option",
        options: [
          {
            longFlag: "--local-help",
            shortFlag: "-h",
            description: "Conflict.",
            optionRequired: false,
          },
        ],
      },
    ]),
  ).toThrow('conflicting option "-h"');
  expect(() =>
    snapshotCommandDefinitions([
      {
        ...futureCommand,
        name: "reserved-behavior",
        options: [
          {
            longFlag: "--local-help",
            description: "Invalid framework behavior.",
            optionRequired: false,
            behavior: "help",
          },
        ],
      },
    ]),
  ).toThrow("cannot declare framework option behavior");
  expect(() =>
    snapshotCommandDefinitions([
      {
        ...futureCommand,
        name: "required-default",
        options: [
          {
            longFlag: "--mode",
            description: "Contradictory option.",
            value: { name: "mode", required: true },
            optionRequired: true,
            defaultValue: "safe",
          },
        ],
      },
    ]),
  ).toThrow("cannot default a required option");
  expect(() =>
    snapshotCommandDefinitions([
      {
        ...futureCommand,
        name: "invalid-default",
        options: [
          {
            longFlag: "--mode",
            description: "Invalid default.",
            value: { name: "mode", required: true },
            optionRequired: false,
            defaultValue: "unsafe",
            values: ["safe"],
          },
        ],
      },
    ]),
  ).toThrow("option default must be one of its choices");
  expect(() =>
    snapshotCommandDefinitions([
      {
        ...futureCommand,
        name: "parent",
        options: [
          {
            longFlag: "--mode",
            description: "Parent mode.",
            value: { name: "mode", required: true },
            optionRequired: false,
          },
        ],
      },
      {
        ...futureCommand,
        name: "parent.child",
        options: [],
      },
    ]),
  ).toThrow('Command "parent" cannot combine local arguments with child commands');
});

test("describes registered commands from a single registry", () => {
  expect(describeCommand()).toMatchObject({
    name: "lore",
    options: [
      { behavior: "help", name: "-h, --help", scope: "global" },
      {
        behavior: "version",
        name: "-V, --version",
        scope: "root",
        response: {
          command: "version",
          resultSchema: {
            required: ["protocolVersion", "toolVersion"],
            type: "object",
          },
        },
      },
      {
        behavior: "log-level",
        defaultValue: "error",
        name: "--log-level <level>",
        scope: "global",
      },
    ],
    commands: [
      {
        name: "describe",
        positionals: [{ name: "command", values: ["describe"] }],
      },
    ],
  });
  expect(describeCommand("describe")).toMatchObject({
    options: [
      { behavior: "help", scope: "global" },
      { behavior: "log-level", scope: "global" },
    ],
  });
});

test("registers every command definition with an executable handler", () => {
  for (const command of commandRegistry) {
    const description = describeCommand(command.name) as { name: string; usage: string };
    expect(description.name).toBe(command.name);
    expect(description.usage).toContain(command.name.replaceAll(".", " "));
    expect(command.handler).toBeInstanceOf(Function);
  }
});

test("derives parser options and describe metadata from registered commands", async () => {
  const definitions = [...commandRegistry, futureCommand];
  expect(describeCommand("future", definitions)).toMatchObject({
    name: "future",
    options: [
      { behavior: "help", scope: "global" },
      { behavior: "log-level", scope: "global" },
      { name: "--future-mode <mode>", scope: "command" },
    ],
  });
  expect(describeCommand("describe", definitions)).toMatchObject({
    positionals: [{ name: "command", values: ["describe", "future"] }],
  });

  const stdout = new MemoryWriter();
  expect(await run(["future", "--future-mode", "safe"], { registry: definitions, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "future", data: { mode: "safe" } });

  const missingRequiredOption = new MemoryWriter();
  expect(await run(["future"], { registry: definitions, stdout: missingRequiredOption })).toBe(2);

  const unsupportedOptionValue = new MemoryWriter();
  expect(
    await run(["future", "--future-mode", "unsafe"], {
      registry: definitions,
      stdout: unsupportedOptionValue,
    }),
  ).toBe(2);

  const help = new MemoryWriter();
  expect(await run(["future", "--help"], { registry: definitions, stdout: help })).toBe(0);
  expect(JSON.parse(help.value)).toMatchObject({ command: "describe", data: { name: "future" } });
});

test("keeps parser and describe on the same immutable program snapshot", async () => {
  const definitions: CommandDefinition[] = [...commandRegistry, futureCommand];
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const program = createProgram(
    { logger: new Logger(stderr) },
    stdout,
    { selectCommand() {}, setExitCode() {} },
    definitions,
  );

  definitions.pop();
  await program.parseAsync(["future", "--help"], { from: "user" });

  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "describe",
    data: { name: "future" },
  });
});

test("returns exit code 1 with a successful blocking domain result", async () => {
  const blockingCommand: CommandDefinition = {
    name: "future-domain",
    summary: "Report a completed blocking domain finding.",
    positionals: [],
    options: [],
    resultSchema: { type: "object" },
    errorCodes: frameworkErrorCodes,
    exitCodes: [0, 1, 2],
    handler: () => ({ data: { blocking: true }, exitCode: 1 }),
  };
  const stdout = new MemoryWriter();

  expect(
    await run(["future-domain"], {
      registry: [...commandRegistry, blockingCommand],
      stdout,
    }),
  ).toBe(1);
  expect(stdout.value.trimEnd().split("\n")).toHaveLength(1);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "future-domain",
    data: { blocking: true },
    ok: true,
  });
});

test("renders one failure when a handler returns an undeclared completion", async () => {
  const command: CommandDefinition = {
    name: "future-undeclared-exit",
    summary: "Exercise centralized completion validation.",
    positionals: [],
    options: [],
    resultSchema: { type: "object" },
    errorCodes: frameworkErrorCodes,
    exitCodes: [0, 2],
    handler: () => ({ data: { blocking: true }, exitCode: 1 }),
  };
  const stdout = new MemoryWriter();

  expect(await run([command.name], { registry: [...commandRegistry, command], stdout })).toBe(2);
  expect(stdout.value.trimEnd().split("\n")).toHaveLength(1);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: command.name,
    error: { code: cliErrorCodes.runtimeUnexpected },
    ok: false,
  });
});

test("normalizes non-JSON-safe handler data before any success is written", async () => {
  const command: CommandDefinition = {
    name: "future-invalid-data",
    summary: "Exercise the JSON-safe process boundary.",
    positionals: [],
    options: [],
    resultSchema: { type: "object" },
    errorCodes: frameworkErrorCodes,
    exitCodes: [0, 2],
    handler: () => ({ data: undefined as never }),
  };
  const stdout = new MemoryWriter();

  expect(await run([command.name], { registry: [...commandRegistry, command], stdout })).toBe(2);
  expect(stdout.value.trimEnd().split("\n")).toHaveLength(1);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: command.name,
    error: { code: cliErrorCodes.runtimeUnexpected },
    ok: false,
  });
});

test("normalizes handler errors that are not visible in command metadata", async () => {
  const command: CommandDefinition = {
    name: "future-failure",
    summary: "Exercise the visible error allowlist.",
    positionals: [],
    options: [],
    resultSchema: { type: "object" },
    errorCodes: frameworkErrorCodes,
    exitCodes: [0, 2],
    handler: () => {
      throw new CliError("domain.private", "Private handler detail.");
    },
  };
  const stdout = new MemoryWriter();

  expect(
    await run(["future-failure"], {
      registry: [...commandRegistry, command],
      stdout,
    }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "future-failure",
    error: {
      code: cliErrorCodes.runtimeUnexpected,
      message: "The command could not be completed.",
    },
    ok: false,
  });
  expect(stdout.value).not.toContain("domain.private");
  expect(stdout.value).not.toContain("Private handler detail");
});

test("preserves handler errors declared in command metadata", async () => {
  const command: CommandDefinition = {
    name: "future-visible-failure",
    summary: "Exercise a declared domain error.",
    positionals: [],
    options: [],
    resultSchema: { type: "object" },
    errorCodes: [...frameworkErrorCodes, "domain.visible"],
    exitCodes: [0, 2],
    handler: () => {
      throw new CliError("domain.visible", "The domain call could not be completed.");
    },
  };
  const stdout = new MemoryWriter();

  expect(
    await run(["future-visible-failure"], {
      registry: [...commandRegistry, command],
      stdout,
    }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "future-visible-failure",
    error: {
      code: "domain.visible",
      message: "The domain call could not be completed.",
    },
    ok: false,
  });
});

test("registers parent and nested commands from dotted command names", async () => {
  const definitions: readonly CommandDefinition[] = [
    ...commandRegistry,
    {
      name: "config",
      summary: "Return configuration capabilities.",
      positionals: [],
      options: [],
      resultSchema: { type: "object" },
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      handler: () => ({ data: { kind: "root" } }),
    },
    {
      name: "config.path",
      summary: "Return the selected configuration path.",
      positionals: [],
      options: [],
      resultSchema: { type: "object" },
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      handler: () => ({ data: { kind: "nested" } }),
    },
  ];

  const root = new MemoryWriter();
  expect(await run(["config"], { registry: definitions, stdout: root })).toBe(0);
  expect(JSON.parse(root.value)).toMatchObject({ command: "config", data: { kind: "root" } });

  const nested = new MemoryWriter();
  expect(await run(["config", "path"], { registry: definitions, stdout: nested })).toBe(0);
  expect(JSON.parse(nested.value)).toMatchObject({
    command: "config.path",
    data: { kind: "nested" },
  });

  const description = new MemoryWriter();
  expect(
    await run(["describe", "config.path"], {
      registry: definitions,
      stdout: description,
    }),
  ).toBe(0);
  expect(JSON.parse(description.value)).toMatchObject({
    command: "describe",
    data: { name: "config.path", usage: "config path" },
  });
});
