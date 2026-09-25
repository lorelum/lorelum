import { BackendError, EmbeddingError } from "@lorelum/backend/protocol";
import type { JsonValue } from "../output/protocol";
import type { CommandDefinition, CommandInvocation } from "../registry";
import { CliError, frameworkErrorCodes } from "../runtime/errors";

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
        if (error instanceof BackendError)
          throw new CliError(error.code, error.message, error.recovery);
        if (error instanceof EmbeddingError) throw new CliError(error.code, error.message);
        throw error;
      }
    },
  };
}
