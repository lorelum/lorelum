import { expect, test } from "bun:test";
import { ConfigError } from "@lorelum/config";
import { CliError, toVisibleCliError } from "./errors.js";
import { configurationFailureFrom } from "./config-failure.js";

test("only the preserved config cause supplies terminal configuration facts", () => {
  const configError = new ConfigError({
    kind: "document",
    source: { kind: "file", path: "/example/config.yaml" },
    reason: "root-shape",
  });
  const error = new CliError("query.config-invalid", configError.message, undefined, {
    cause: configError,
  });
  expect(configurationFailureFrom(error)).toBe(configError.failure);
  expect(
    configurationFailureFrom(new CliError("usage.invalid", "Invalid option.")),
  ).toBeUndefined();
  expect(configurationFailureFrom({ cause: configError })).toBeUndefined();
  expect(
    configurationFailureFrom(toVisibleCliError(error, ["runtime.unexpected"])),
  ).toBeUndefined();
});
