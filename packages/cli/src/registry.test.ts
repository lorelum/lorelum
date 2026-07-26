import { expect, test } from "bun:test";

import type { CommandDefinition } from "./registry.js";
import { run } from "./main.js";
import { renderSuccess } from "./output/protocol.js";
import { commandRegistry, describeCommand, inspectInvocation } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("describes registered commands from a single registry", () => {
  const description = describeCommand() as {
    commands: { errorCodes: string[]; name: string }[];
    name: string;
  };
  expect(description.name).toBe("lore");
  expect(description.commands.map((command) => command.name)).toEqual(
    expect.arrayContaining(["describe", "config", "config.path", "config.show", "validate"]),
  );
  expect(description.commands.every((command) => Array.isArray(command.errorCodes))).toBe(true);
  expect(Object.hasOwn(description, "handler")).toBe(false);
});

test("registers every command definition with an executable handler", () => {
  for (const command of commandRegistry) {
    expect(command.handler).toBeInstanceOf(Function);
  }
});

test("validates commands and global options before special responses", () => {
  expect(inspectInvocation(["describe", "--help"])).toEqual({
    command: "describe",
    configPath: undefined,
    help: true,
    valid: true,
    version: false,
  });
  expect(inspectInvocation(["missing", "--help"])).toMatchObject({ valid: false });
  expect(inspectInvocation(["--log-level", "--version"])).toMatchObject({ valid: false });
  expect(inspectInvocation(["--log-level=debug"])).toMatchObject({ valid: true });
  expect(inspectInvocation(["--log-level=verbose"])).toMatchObject({ valid: false });
  expect(inspectInvocation(["validate", "pack", "--lenient"])).toMatchObject({
    command: "validate",
    valid: true,
  });
  expect(inspectInvocation(["config", "show", "--lenient"])).toMatchObject({ valid: false });
  expect(inspectInvocation(["--config=/tmp/config.json", "config", "path"])).toMatchObject({
    command: "config.path",
    configPath: "/tmp/config.json",
    valid: true,
  });
  expect(describeCommand("config.show")).toMatchObject({
    errorCodes: expect.arrayContaining(["config.unknown_field", "config.unsupported_version"]),
  });
});

test("derives invocation validation, parser options, and describe metadata from registered commands", async () => {
  const futureCommand: CommandDefinition = {
    usage: "future",
    name: "future",
    summary: "Temporary registry regression command.",
    positionals: [],
    options: [
      {
        name: "--future-mode <mode>",
        description: "Exercise command-specific option registration.",
        required: true,
        values: ["safe"],
      },
    ],
    resultSchema: { type: "object" },
    errorCodes: [],
    exitCodes: [0],
    handler: (output, invocation) => {
      renderSuccess(output, "future", { mode: invocation.options.futureMode });
    },
  };
  commandRegistry.push(futureCommand);

  try {
    expect(inspectInvocation(["future"])).toMatchObject({ command: "future", valid: false });
    expect(inspectInvocation(["future", "--future-mode", "safe"])).toMatchObject({
      command: "future",
      valid: true,
    });
    expect(inspectInvocation(["future", "--future-mode", "unsafe"])).toMatchObject({
      valid: false,
    });
    expect(inspectInvocation(["future", "--help"])).toMatchObject({
      command: "future",
      help: true,
      valid: true,
    });
    expect(describeCommand("future")).toMatchObject({ name: "future" });
    expect(describeCommand("describe")).toMatchObject({
      positionals: [
        { name: "command", values: expect.arrayContaining(["describe", "config", "future"]) },
      ],
    });

    const stdout = new MemoryWriter();
    expect(await run(["future", "--future-mode", "safe"], { stdout })).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({ command: "future", data: { mode: "safe" } });

    const missingRequiredOption = new MemoryWriter();
    expect(await run(["future"], { stdout: missingRequiredOption })).toBe(2);
  } finally {
    commandRegistry.pop();
  }
});
