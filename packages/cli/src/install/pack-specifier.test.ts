import { expect, test } from "bun:test";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { parsePackSpecifier } from "./pack-specifier.js";

test("parses Pack names with an optional exact version", () => {
  expect(parsePackSpecifier("agentic-coding")).toEqual({
    packName: "agentic-coding",
    requestedVersion: undefined,
  });
  expect(parsePackSpecifier("agentic-coding@1.2.3-beta.1+build.5")).toEqual({
    packName: "agentic-coding",
    requestedVersion: "1.2.3-beta.1+build.5",
  });
});

test.each(["", "Agentic", "agentic@", "@1.2.3", "agentic@1.2", "agentic@1.2.3@next"])(
  "rejects malformed Pack specifier %p before Registry access",
  (specifier) => {
    try {
      parsePackSpecifier(specifier);
      throw new Error("Expected invalid Pack specifier");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(error).toMatchObject({ code: cliErrorCodes.usageInvalid });
      expect((error as Error).message).toMatch(/Pack name|pack@version|one @/);
    }
  },
);
