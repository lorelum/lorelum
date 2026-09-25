import { expect, test } from "bun:test";
import { BackendError } from "@lorelum/backend/protocol";
import type { CommandInvocation } from "../registry.js";
import { lifecycleCommand } from "./common.js";

test("lifecycle commands preserve a declared BackendError message", async () => {
  const command = lifecycleCommand({
    name: "backend.fixture",
    summary: "Fixture command.",
    resultSchema: { type: "object" },
    errorCodes: ["backend.config-invalid"],
    execute: () => Promise.reject(new BackendError("backend.config-invalid")),
  });

  await expect(command.handler({} as CommandInvocation)).rejects.toMatchObject({
    name: "CliError",
    code: "backend.config-invalid",
    message: "The local backend configuration is invalid.",
  });
});
