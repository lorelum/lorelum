import { expect, test } from "bun:test";

import { PACKAGE_NAME } from "./index.js";

test("exports the CLI package name", () => {
  expect(PACKAGE_NAME).toBe("@lorelum/cli");
});
