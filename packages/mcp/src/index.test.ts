import { describe, expect, test } from "bun:test";

import { PACKAGE_NAME } from "./index";

describe("@lorelum/mcp", () => {
  test("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@lorelum/mcp");
  });
});
