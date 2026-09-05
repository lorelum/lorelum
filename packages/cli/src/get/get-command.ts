import {
  createGetService,
  defaultStorageRoot,
  type GetService,
  type StorageRoot,
} from "@lorelum/engine";
import { ID_REGEX } from "@lorelum/format";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { getPracticeSchema, sourceSchema } from "../output/schema-primitives.js";
import { getRetrievalErrorCodes } from "../retrieval/errors.js";
import type { CommandDefinition } from "../registry.js";
import { invalidInvocationError } from "../runtime/errors.js";
import { throwGetVisibleError } from "../retrieval/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";

export interface GetCommandServices {
  readonly get: GetService;
  readonly storageRoot: StorageRoot;
}

function defaultGetServices(): GetCommandServices {
  const storageRoot = defaultStorageRoot();
  return { get: createGetService({ storageRoot }), storageRoot };
}

const resultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generation", "effectiveRevision", "practice", "sources"],
  properties: {
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    practice: getPracticeSchema,
    sources: { type: "array", items: sourceSchema },
  },
};

/** `lore get` data contract (ADR 0011); registry validates handler output. */
export function createGetCommand(
  services: GetCommandServices = defaultGetServices(),
): CommandDefinition {
  return {
    name: "get",
    summary: "Retrieve exactly one canonical Practice by id from the LocalStore.",
    positionals: [{ name: "practice-id", required: true }],
    options: [],
    resultSchema,
    errorCodes: getRetrievalErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      // Syntax validation belongs to the CLI adapter: malformed ids are
      // `usage.invalid`, while valid-format unknown ids stay domain errors.
      const practiceId = invocation.positionals[0];
      if (
        practiceId === undefined ||
        practiceId.trim().length === 0 ||
        !ID_REGEX.test(practiceId)
      ) {
        throw invalidInvocationError();
      }
      const storageRoot = resolveInvocationStorageRoot(
        invocation.options.storeRoot,
        services.storageRoot,
      );

      try {
        const result = await services.get.get({ practiceId, storageRoot });
        return { data: result as unknown as JsonValue };
      } catch (error) {
        throwGetVisibleError(error);
      }
    },
  };
}
