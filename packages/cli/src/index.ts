export { createProgram, type CliRuntime, type ProgramLifecycle } from "./create-program.js";
export { run, type RunOptions } from "./main.js";
export {
  DEFAULT_MAX_CHARACTERS,
  renderPackCatalog,
  type InstalledPackCatalogEntry,
  type RenderPackCatalogOptions,
} from "./hook/pack-catalog.js";
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
  createFailureEnvelope,
  createSuccessEnvelope,
  protocolResponseSchema,
  protocolVersion,
  toolVersion,
  type JsonSchema,
  type JsonValue,
  type OutputWriter,
  type ProtocolFailure,
  type ProtocolSuccess,
} from "./output/protocol.js";
export { renderResult, type OutputFormat, type TextRenderer } from "./output/render.js";
