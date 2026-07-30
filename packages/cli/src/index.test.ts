import { expect, test } from "bun:test";

import {
  PACKAGE_NAME,
  protocolResponseSchema,
  protocolVersion,
  toolVersion,
  type ProtocolSuccess,
} from "@lorelum/cli";

test("exports the CLI package contract", () => {
  expect(PACKAGE_NAME).toBe("@lorelum/cli");
  expect(protocolResponseSchema).toHaveProperty("oneOf");
  expect(protocolVersion).toBe(1);
  expect(toolVersion).toBe("0.0.0");

  const response: ProtocolSuccess<{ name: string }> = {
    protocolVersion,
    toolVersion,
    command: "describe",
    ok: true,
    data: { name: "lore" },
  };
  expect(response.data.name).toBe("lore");
});
