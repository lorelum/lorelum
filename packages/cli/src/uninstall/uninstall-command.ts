import {
  PackNotInstalledError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";
import { PACK_NAME_REGEX } from "@lorelum/format";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import {
  CliError,
  cliErrorCodes,
  frameworkErrorCodes,
  invalidInvocationError,
} from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import {
  mutationResultProperties,
  mutationResultRequired,
  stringSchema,
  toMutationResultData,
} from "../store/mutation-result.js";

export interface RemoveCommandServices {
  readonly store: Pick<LocalStore, "uninstall">;
  readonly storageRoot: StorageRoot;
}

const resultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pack", ...mutationResultRequired],
  properties: {
    pack: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: stringSchema },
    },
    ...mutationResultProperties,
  },
};

const uninstallErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.packNotInstalled,
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
]);

function throwVisibleUninstallError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (error instanceof PackNotInstalledError) {
    throw new CliError(cliErrorCodes.packNotInstalled, "The specified Pack is not installed.");
  }
  if (error instanceof StoreBusyError) {
    throw new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
  }
  if (error instanceof StoreRecoveryRequiredError) {
    throw new CliError(
      cliErrorCodes.storeRecoveryRequired,
      "The local Pack store requires recovery.",
    );
  }
  throw error;
}

export function createRemoveCommand(services: RemoveCommandServices): CommandDefinition {
  return {
    name: "pack.remove",
    summary: "Remove an installed Knowledge Pack from the selected local Store.",
    positionals: [{ name: "pack", required: true }],
    options: [],
    resultSchema,
    errorCodes: uninstallErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      const packName = invocation.positionals[0]!;
      if (!PACK_NAME_REGEX.test(packName))
        throw invalidInvocationError("Provide a valid Pack name to remove.");
      try {
        const result = await services.store.uninstall(
          resolveInvocationStorageRoot(invocation.options.storeRoot, services.storageRoot),
          packName,
        );
        return {
          data: {
            pack: { name: packName },
            ...toMutationResultData(result),
          } satisfies JsonValue,
        };
      } catch (error) {
        throwVisibleUninstallError(error);
      }
    },
  };
}
