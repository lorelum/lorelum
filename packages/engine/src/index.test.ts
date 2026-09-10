import { describe, expect, test } from "bun:test";

import { PACKAGE_NAME, createListService, retrievePackPractices, retrievePacks } from "./index";

describe("@lorelum/engine", () => {
  test("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@lorelum/engine");
  });

  test("exposes the List runtime API through the package boundary", () => {
    expect(typeof createListService).toBe("function");
    expect(typeof retrievePacks).toBe("function");
    expect(typeof retrievePackPractices).toBe("function");
  });
});
