import { BackendError, EmbeddingError } from "@lorelum/backend/protocol";
import type { JsonValue } from "../output/protocol";
import type { CommandDefinition, CommandInvocation } from "../registry";
import { frameworkErrorCodes } from "../runtime/errors";
import { backendCliError } from "./error";

/** Defaults and error translation shared by backend/model lifecycle commands. */
export function lifecycleCommand(
  definition: Pick<CommandDefinition, "name" | "summary" | "resultSchema" | "errorCodes"> & {
    execute: (invocation: CommandInvocation) => Promise<JsonValue>;
  },
): CommandDefinition {
  const { execute, ...metadata } = definition;
  return {
    ...metadata,
    positionals: [],
    options: [],
    exitCodes: [0, 2],
    errorCodes: [...frameworkErrorCodes, ...metadata.errorCodes],
    async handler(invocation) {
      try {
        return { data: await execute(invocation) };
      } catch (error) {
        if (error instanceof BackendError || error instanceof EmbeddingError)
          throw await backendCliError(error);
        throw error;
      }
    },
  };
}
