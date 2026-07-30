export const PACKAGE_NAME = "@lorelum/cli";

export { createProgram, type CliRuntime, type ProgramLifecycle } from "./create-program.js";
export { run, type RunOptions } from "./main.js";
export {
  commandRegistry,
  describeCommand,
  type CommandDefinition,
  type CommandInvocation,
  type CommandOption,
  type CommandResult,
  type PositionalArgument,
} from "./registry.js";
export {
  protocolResponseSchema,
  protocolVersion,
  toolVersion,
  type JsonSchema,
  type JsonValue,
  type OutputWriter,
  type ProtocolFailure,
  type ProtocolSuccess,
} from "./output/protocol.js";
