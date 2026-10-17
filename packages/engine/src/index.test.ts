import { describe, expect, test } from "bun:test";

import {
  createListService,
  retrievePackDetails,
  retrievePackPractices,
  retrievePacks,
} from "./index";

describe("@lorelum/engine", () => {
  test("exposes the List runtime API through the package boundary", () => {
    expect(typeof createListService).toBe("function");
    expect(typeof retrievePackDetails).toBe("function");
    expect(typeof retrievePacks).toBe("function");
    expect(typeof retrievePackPractices).toBe("function");
  });
});
