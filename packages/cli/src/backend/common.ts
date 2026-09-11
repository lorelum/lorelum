import { BackendError, EmbeddingError } from "@lorelum/backend/protocol";
import type { JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { CliError, frameworkErrorCodes } from "../runtime/errors";

/** Defaults and error translation shared by backend/model lifecycle commands. */
export function lifecycleCommand(
  definition: Pick<CommandDefinition, "name" | "summary" | "resultSchema" | "errorCodes"> & {
    execute: () => Promise<JsonValue>;
  },
): CommandDefinition {
  const { execute, ...metadata } = definition;
  return {
    ...metadata,
    positionals: [],
    options: [],
    exitCodes: [0, 2],
    errorCodes: [...frameworkErrorCodes, ...metadata.errorCodes],
    async handler() {
      try {
        return { data: await execute() };
      } catch (error) {
        if (error instanceof BackendError || error instanceof EmbeddingError)
          throw new CliError(error.code, error.message);
        throw error;
      }
    },
  };
}
