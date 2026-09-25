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
  expect(protocolVersion).toBe(3);
  expect(toolVersion).toBe("0.1.0-alpha.4");

  const response: ProtocolSuccess<{ name: string }> = {
    protocolVersion,
    toolVersion,
    command: "describe",
    diagnostics: { traceId: "00000000-0000-4000-8000-000000000001" as never },
    ok: true,
    data: { name: "lore" },
  };
  expect(response.data.name).toBe("lore");
});
