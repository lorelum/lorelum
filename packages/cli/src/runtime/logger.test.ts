import { expect, test } from "bun:test";

import { Logger } from "./logger.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("filters logs by the configured level", () => {
  const writer = new MemoryWriter();
  const logger = new Logger(writer);
  logger.setLevel("warn");
  expect(logger.isEnabled("info")).toBe(false);
  expect(logger.isEnabled("warn")).toBe(true);
  expect(logger.isEnabled("error")).toBe(true);

  logger.log("info", "hidden");
  logger.log("warn", "visible");

  expect(writer.value).toBe("[warn] visible\n");
});
