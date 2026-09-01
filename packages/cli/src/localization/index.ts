import type { CommandDefinition } from "../registry.js";
import { createFormatCommand } from "./format-command.js";
import { createSyncCommand } from "./sync-command.js";
import { createValidateCommand } from "./validate-command.js";

export function createLocalizationCommands(): readonly CommandDefinition[] {
  return [createFormatCommand(), createSyncCommand(), createValidateCommand()];
}
