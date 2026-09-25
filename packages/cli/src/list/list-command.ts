import type {
  ListPackDetailsResult,
  ListPackPracticesResult,
  ListPacksResult,
  ListService,
  StorageRoot,
} from "@lorelum/engine";
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
const stringArraySchema: JsonSchema = { type: "array", items: stringSchema };

const installedPackSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version", "packRoot", "practiceCount"],
  properties: {
    name: stringSchema,
    version: stringSchema,
    packRoot: stringSchema,
    practiceCount: { type: "integer" },
  },
};

const packSummarySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version", "packRoot"],
  properties: { name: stringSchema, version: stringSchema, packRoot: stringSchema },
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

const richPackSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version", "packRoot", "appliesTo"],
  properties: {
    name: stringSchema,
    version: stringSchema,
    packRoot: stringSchema,
    description: stringSchema,
    appliesTo: stringArraySchema,
  },
};

const packListSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "packs"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    packs: { type: "array", minItems: 1, items: installedPackSchema },
  },
};

const richPackListSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "packs"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    packs: { type: "array", minItems: 1, items: richPackSchema },
  },
};

const emptyPackListSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "packs"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    packs: { type: "array", maxItems: 0 },
  },
};

const practiceCatalogSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "pack", "practices"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    pack: packSummarySchema,
    practices: { type: "array", items: listedPracticeSchema },
  },
};

const resultSchema: JsonSchema = {
  oneOf: [packListSchema, richPackListSchema, emptyPackListSchema, practiceCatalogSchema],
};

function toPackListData(result: ListPacksResult): JsonValue {
  return {
    generation: result.generation,
    effectiveRevision: result.effectiveRevision,
    packs: result.packs.map((pack) => ({
      name: pack.name,
      version: pack.version,
      packRoot: pack.packRoot,
      practiceCount: pack.practiceCount,
    })),
  };
}

function toRichPackListData(result: ListPackDetailsResult): JsonValue {
  return {
    generation: result.generation,
    effectiveRevision: result.effectiveRevision,
    packs: result.packs.map((pack) => ({
      name: pack.name,
      version: pack.version,
      packRoot: pack.packRoot,
      ...(pack.description === undefined ? {} : { description: pack.description }),
      appliesTo: [...(pack.applies_to ?? [])],
    })),
  };
}

function toPracticeCatalogData(result: ListPackPracticesResult): JsonValue {
  return {
    generation: result.generation,
    effectiveRevision: result.effectiveRevision,
    pack: {
      name: result.pack.name,
      version: result.pack.version,
      packRoot: result.pack.packRoot,
    },
    practices: result.practices.map((practice) => ({
      id: practice.id,
      title: practice.title,
      applies_when: practice.applies_when,
    })),
  };
}

export function createListCommand(services: ListCommandServices): CommandDefinition {
  return {
    name: "pack.list",
    summary: "List installed Packs and their Practice catalogs from the LocalStore.",
    positionals: [{ name: "pack", required: false }],
    options: [
      {
        longFlag: "--details",
        description: "Include rich metadata for every installed Pack.",
        optionRequired: false,
      },
    ],
    resultSchema,
    errorCodes: listErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      const packName = invocation.positionals[0];
      const details = invocation.options.details;
      if (details !== undefined && details !== true)
        throw invalidInvocationError("--details is a flag and takes no value.");
      if (packName !== undefined && !PACK_NAME_REGEX.test(packName))
        throw invalidInvocationError("Provide a valid Pack name.");
      if (packName !== undefined && details === true)
        throw invalidInvocationError("Use a Pack name or --details, not both.");

      const storageRoot = resolveInvocationStorageRoot(
        invocation.options.storeRoot,
        services.storageRoot,
      );

      try {
        if (details === true) {
          return { data: toRichPackListData(await services.list.listPackDetails({ storageRoot })) };
        }
        if (packName === undefined) {
          return { data: toPackListData(await services.list.list({ storageRoot })) };
        }
        return {
          data: toPracticeCatalogData(await services.list.listPack({ packName, storageRoot })),
        };
      } catch (error) {
        throwListVisibleError(error);
      }
    },
  };
}
