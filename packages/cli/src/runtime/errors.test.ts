import { describe, expect, test } from "bun:test";

import { CliError, toVisibleCliError } from "./errors.js";

describe("toVisibleCliError message handling", () => {
  test("preserves validator-owned messages for declared codes", () => {
    const error = new CliError("usage.invalid", "--top-k must be a positive integer.");
    expect(toVisibleCliError(error, ["usage.invalid"], "query").message).toBe(error.message);
  });

  test("downgrades undeclared codes without leaking their message", () => {
    const visible = toVisibleCliError(
      new CliError("pack.invalid", "private-token"),
      ["usage.invalid", "runtime.unexpected"],
      "pack.list",
    );
    expect(visible).toMatchObject({
      code: "runtime.unexpected",
      message: "The command could not be completed.",
    });
  });

  test("maps Commander categories to command-specific help without raw input", () => {
    const commanderError = Object.assign(new Error("private-token"), {
      code: "commander.unknownOption",
    });
    const visible = toVisibleCliError(commanderError, ["usage.invalid"], "pack.install");
    expect(visible).toMatchObject({
      code: "usage.invalid",
      message: "Unknown option. Run lore pack install --help to see valid arguments.",
    });
    expect(visible.message).not.toContain("private-token");
    const invalidValue = toVisibleCliError(
      Object.assign(new Error("private-token"), { code: "commander.invalidArgument" }),
      ["usage.invalid"],
      "query",
    );
    expect(invalidValue.message).toBe(
      "An option or argument value is not allowed. Run lore query --help to see valid arguments.",
    );
  });

  test("generic usage failures offer the selected command Help", () => {
    const visible = toVisibleCliError(
      new CliError("usage.invalid", "The command invocation is invalid."),
      ["usage.invalid"],
      "query",
    );
    expect(visible.message).toBe(
      "Invalid invocation. Run lore query --help to see valid arguments.",
    );
  });
});
