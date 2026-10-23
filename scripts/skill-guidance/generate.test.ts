import { expect, test } from "bun:test";
import { parseGuidanceMode } from "./generate.ts";

test("generation command requires exactly one explicit mode", () => {
  expect(parseGuidanceMode(["--write"])).toBe("write");
  expect(parseGuidanceMode(["--check"])).toBe("check");
  expect(() => parseGuidanceMode([])).toThrow("Choose exactly one of --write or --check");
  expect(() => parseGuidanceMode(["--unknown"])).toThrow("Unknown argument");
  expect(() => parseGuidanceMode(["--write", "--check"])).toThrow(
    "Choose exactly one of --write or --check",
  );
});
