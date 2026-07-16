import { describe, expect, test } from "bun:test";

import { PACKAGE_NAME } from "./index";

describe("@lorelum/shared", () => {
  test("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@lorelum/shared");
  });
});
