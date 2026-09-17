export const PACKAGE_NAME = "@lorelum/cli";

export { createProgram, type CliRuntime, type ProgramLifecycle } from "./create-program.js";
export { run, type RunOptions } from "./main.js";
export {
  buildCodexHookResponse,
  createCodexHookResponse,
  parseCodexHookInvocation,
  runCodexHook,
  type CodexHookEvent,
  type CodexHookInput,
  type CodexHookResponse,
  type CodexHookServices,
  type CodexHookInvocation,
  type RunCodexHookOptions,
  type TextInput,
} from "./hook/codex.js";
export {
  buildZcodeHookResponse,
  createZcodeHookResponse,
  parseZcodeHookInvocation,
  runZcodeHook,
  type ZcodeHookEvent,
  type ZcodeHookInput,
  type ZcodeHookResponse,
  type ZcodeHookServices,
  type ZcodeHookInvocation,
  type RunZcodeHookOptions,
} from "./hook/zcode.js";
export {
  DEFAULT_MAX_CHARACTERS as CODEX_HOOK_CATALOG_MAX_CHARACTERS,
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
