import type { ListService, StorageRoot } from "@lorelum/engine";
import { PACK_NAME_REGEX } from "@lorelum/format";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { listErrorCodes, throwListVisibleError } from "./errors.js";
import type { CommandDefinition } from "../registry.js";
import { invalidInvocationError } from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";

export interface ListCommandServices {
  readonly list: ListService;
  readonly storageRoot: StorageRoot;
}

const stringSchema: JsonSchema = { type: "string" };

const installedPackSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version", "practiceCount"],
  properties: {
    name: stringSchema,
    version: stringSchema,
    practiceCount: { type: "integer" },
  },
};

const packSummarySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version"],
  properties: { name: stringSchema, version: stringSchema },
};

const listedPracticeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "applies_when"],
  properties: {
    id: stringSchema,
    title: stringSchema,
    applies_when: stringSchema,
  },
};

const resultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["generation", "effectiveRevision", "packs"],
      properties: {
        generation: { type: "integer" },
        effectiveRevision: { type: "integer" },
        packs: { type: "array", items: installedPackSchema },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["generation", "effectiveRevision", "pack", "practices"],
      properties: {
        generation: { type: "integer" },
        effectiveRevision: { type: "integer" },
        pack: packSummarySchema,
        practices: { type: "array", items: listedPracticeSchema },
      },
    },
  ],
};

export function createListCommand(
  services: ListCommandServices,
): CommandDefinition {
  return {
    name: "list",
    summary: "List installed Packs and their Practice catalogs from the LocalStore.",
    positionals: [],
    options: [
      {
        longFlag: "--pack",
        description: "List the Practice catalog for one installed Pack.",
        value: { name: "name", required: true },
        optionRequired: false,
      },
    ],
    resultSchema,
    errorCodes: listErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      const packName = invocation.options.pack;
      if (
        packName !== undefined &&
        (typeof packName !== "string" || !PACK_NAME_REGEX.test(packName))
      ) {
        throw invalidInvocationError();
      }

      const storageRoot = resolveInvocationStorageRoot(
        invocation.options.storeRoot,
        services.storageRoot,
      );

      try {
        const result =
          packName === undefined
            ? await services.list.list({ storageRoot })
            : await services.list.listPack({ packName, storageRoot });
        return { data: result as unknown as JsonValue };
      } catch (error) {
        throwListVisibleError(error);
      }
    },
  };
}
